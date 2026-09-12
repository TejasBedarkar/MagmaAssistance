"""
Core streaming ReAct agent loop, tool execution dispatcher, and write-approval gate.
"""

import asyncio
import json
import logging
import os
import re
from typing import Optional

import httpx
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    trim_messages,
)
from langchain_core.utils.function_calling import convert_to_openai_tool

from config import (
    LLM_MAX_TOKENS,
    LLM_MODEL,
    MAX_COMPLETION_ROUNDS,
    MAX_HISTORY_TOKENS,
    TOOL_RAG_BYPASS_THRESHOLD,
)
import db.postgres_audit_log as audit_log
from llm_client import _clean_schema_for_openai, convert_message_to_dict
import state

logger = logging.getLogger("agent-server")

# ---------------------------------------------------------------------
# Code-enforced write-approval gate predicates and helpers
# ---------------------------------------------------------------------
_GATED_WRITE_OPERATIONS = {
    "create", "insert", "add", "new",       # CREATE_OPERATIONS
    "update", "edit", "modify", "set",      # UPDATE_OPERATIONS
    "submit",                               # SUBMIT_OPERATIONS
}
_ALWAYS_GATED_TOOLS = {"erp_send_email"}


def _is_write_call(tool_name: str, args: dict) -> bool:
    if tool_name in _ALWAYS_GATED_TOOLS:
        return True
    if tool_name == "erp_data_tool":
        operation = str((args or {}).get("operation") or "").strip().lower()
        return operation in _GATED_WRITE_OPERATIONS
    return False


def _describe_pending_action(tool_name: str, args: dict) -> str:
    """Human-readable one/two-liner for the proposal message."""
    args = args or {}
    if tool_name == "erp_send_email":
        recipients = args.get("recipients", "(no recipient given)")
        subject = args.get("subject", "(no subject)")
        return f"Send an email to {recipients} — subject: \"{subject}\""

    if tool_name == "erp_data_tool":
        operation = str(args.get("operation") or "").strip().lower()
        doctype = args.get("doctype", "record")
        if operation in ("submit",):
            return f"Submit {doctype} '{args.get('name')}'"
        if operation in ("update", "edit", "modify", "set"):
            fields = ", ".join(
                f"{k}={v}" for k, v in (args.get("data") or {}).items()
            ) or "(no fields given)"
            return f"Update {doctype} '{args.get('name')}' — set {fields}"
        # create / insert / add / new
        fields = ", ".join(
            f"{k}={v}" for k, v in (args.get("data") or {}).items()
        ) or "(no fields given)"
        suffix = " and submit it" if args.get("submit") else ""
        return f"Create a new {doctype}{suffix} — {fields}"

    return f"Run {tool_name} with {args}"


_YES_RE = re.compile(
    r"^\s*(y|yes|yep|yeah|yup|ya|sure|ok|okay|confirm(?:ed)?|approved?|"
    r"go ahead|do it|go for it|proceed|send it|create it|submit it|"
    r"please do|sounds good|looks good|correct|affirmative)\b",
    re.IGNORECASE,
)
_NO_RE = re.compile(
    r"^\s*(no|nope|nah|cancel|don'?t|stop|abort|never ?mind)\b",
    re.IGNORECASE,
)
_CORRECTION_RE = re.compile(
    r"\b(but|however|wait|hold on|actually|instead|except|change|"
    r"different|rather|update|remove|use|make it|first|before|"
    r"only if|unless|not )\b|\?",
    re.IGNORECASE,
)


def _is_write_approval(message: str) -> bool:
    """True only for an unambiguous go-ahead."""
    text = (message or "").strip()
    if not text or len(text.split()) > 10:
        return False
    if _CORRECTION_RE.search(text):
        return False
    return bool(_YES_RE.match(text))


def _is_write_rejection(message: str) -> bool:
    return bool(_NO_RE.match((message or "").strip()))


# ---------------------------------------------------------------------
# Tool execution dispatcher with gate enforcement and audit logging
# ---------------------------------------------------------------------
async def _execute_tool(
    tool_name: str,
    args: dict,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    prompt_text: Optional[str] = None,
    bypass_gate: bool = False,
):
    if not bypass_gate and session_id and _is_write_call(tool_name, args):
        effective_args = state._sanitize_tool_args(tool_name, args) or {}
        if tool_name == "erp_data_tool":
            effective_args = {**effective_args, "session_id": session_id}
        audit_log.save_pending_approval(session_id, tool_name, effective_args)
        proposal = (
            f"PROPOSED ACTION (not yet executed): {_describe_pending_action(tool_name, effective_args)}\n"
            "Nothing has been written to the ERP yet. Ask the user to confirm "
            "with a plain \"yes\" (or tell you what to change) before anything happens."
        )
        audit_log.log_turn(
            session_id, "tool", proposal, tool_name=tool_name, tool_args=effective_args,
            user_id=user_id, prompt_text=prompt_text, tool_status="awaiting_approval",
        )
        return proposal

    tool = state.tool_map.get(tool_name)
    if tool is None:
        result = f"Tool '{tool_name}' is not available."
        if session_id:
            audit_log.log_turn(
                session_id, "tool", result, tool_name=tool_name, tool_args=args,
                user_id=user_id, prompt_text=prompt_text, tool_status="not_found",
            )
        return result
    try:
        effective_args = state._sanitize_tool_args(tool_name, args) or {}
        if tool_name == "erp_data_tool" and session_id:
            effective_args = {**effective_args, "session_id": session_id}
        with audit_log.time_tool_call() as elapsed:
            result = await tool.ainvoke(effective_args)
        if session_id:
            audit_log.log_turn(
                session_id, "tool", str(result), tool_name=tool_name, tool_args=effective_args,
                user_id=user_id, prompt_text=prompt_text,
                tool_status="approved_executed" if bypass_gate else "success",
                duration_ms=elapsed(),
            )
        if bypass_gate and session_id:
            audit_log.clear_pending_approval(session_id)
        return result
    except PermissionError as e:
        logger.warning("Tool '%s' denied by ERPNext permission check: %s", tool_name, e)
        failure = str(e)
        if session_id:
            audit_log.log_turn(
                session_id, "tool", failure, tool_name=tool_name, tool_args=args,
                user_id=user_id, prompt_text=prompt_text, tool_status="permission_denied",
                error_message=str(e),
            )
            if bypass_gate:
                audit_log.clear_pending_approval(session_id)
        return failure
    except Exception as e:
        logger.exception("Tool '%s' failed", tool_name)
        failure = f"'{tool_name}' failed to fetch ERP data right now."
        if session_id:
            audit_log.log_turn(
                session_id, "tool", failure, tool_name=tool_name, tool_args=args,
                user_id=user_id, prompt_text=prompt_text, tool_status="error",
                error_message=str(e),
            )
            if bypass_gate:
                audit_log.clear_pending_approval(session_id)
        return failure


# ---------------------------------------------------------------------
# LLM streaming completion helpers
# ---------------------------------------------------------------------
async def _stream_chat_completion(messages, tools=None):
    api_messages = [convert_message_to_dict(m) for m in messages]
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    env_openai_key = os.environ.get("OPENAI_API_KEY")
    key = openrouter_key or env_openai_key
    is_openrouter = bool(openrouter_key)
    if is_openrouter:
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:8050",
            "X-Title": "MagmaAssistance",
        }
        url = "https://openrouter.ai/api/v1/chat/completions"
        model_name = LLM_MODEL if "/" in LLM_MODEL else f"openai/{LLM_MODEL}"
    else:
        headers = {"Authorization": f"Bearer {env_openai_key}", "Content-Type": "application/json"}
        url = "https://api.openai.com/v1/chat/completions"
        model_name = LLM_MODEL
    data = {
        "model": model_name,
        "messages": api_messages,
        "temperature": state.assistant.llm.temperature,
        "stream": True,
        "max_tokens": LLM_MAX_TOKENS,
    }
    if tools:
        data["tools"] = tools
    tool_acc = {}
    content = ""
    finish_reason = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=60.0)) as client:
        async with client.stream("POST", url, json=data, headers=headers) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except Exception:
                    continue
                choice = (chunk.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                finish_reason = choice.get("finish_reason") or finish_reason
                if delta.get("content"):
                    content += delta["content"]
                    yield {"type": "token", "text": delta["content"]}
                for tc in delta.get("tool_calls") or []:
                    idx = tc.get("index", 0)
                    entry = tool_acc.setdefault(idx, {"id": None, "name": None, "arguments": ""})
                    if tc.get("id"):
                        entry["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        entry["name"] = fn["name"]
                    if fn.get("arguments"):
                        entry["arguments"] += fn["arguments"]
    tool_calls = []
    for idx in sorted(tool_acc):
        entry = tool_acc[idx]
        try:
            args = json.loads(entry["arguments"]) if entry["arguments"] else {}
        except Exception:
            args = {}
        tool_calls.append({"name": entry["name"], "args": args, "id": entry["id"] or f"call_{idx}"})
    yield {"type": "done", "content": content, "tool_calls": tool_calls, "finish_reason": finish_reason}


async def _stream_full_reply(call_messages, tools=None):
    content = ""
    tool_calls = []
    messages = call_messages
    for round_number in range(MAX_COMPLETION_ROUNDS + 1):
        piece = ""
        async for event in _stream_chat_completion(messages, tools=tools):
            if event["type"] == "token":
                yield {"type": "token", "text": event["text"]}
            else:
                piece = event["content"]
                tool_calls = event["tool_calls"]
                finish_reason = event["finish_reason"]

        content += piece

        if finish_reason != "length" or tool_calls or round_number == MAX_COMPLETION_ROUNDS:
            if finish_reason == "length":
                logger.warning(
                    "Streamed LLM reply still truncated after %d continuation "
                    "round(s); returning what we have.", round_number
                )
            break

        messages = [*call_messages, AIMessage(content=piece), HumanMessage(
            content="Continue exactly where you left off. Do not repeat any text or restart the answer."
        )]

    yield {"type": "done", "content": content, "tool_calls": tool_calls}


# ---------------------------------------------------------------------
# Live streaming agent turn
# ---------------------------------------------------------------------
async def stream_agent_turn(text, session_id=None, user_id=None, history=None, task_context=None):
    history = history if history is not None else []
    start_len = len(history)

    pending = audit_log.get_pending_approval(session_id) if session_id else None
    if pending and _is_write_approval(text):
        history.append(HumanMessage(content=text))
        yield {"type": "tool_call", "name": pending["tool_name"], "args": pending["args"]}
        result = await _execute_tool(
            pending["tool_name"], pending["args"],
            session_id=session_id, user_id=user_id, prompt_text=text,
            bypass_gate=True,
        )
        yield {"type": "tool_result", "name": pending["tool_name"], "result": result}
        summary_messages = [
            SystemMessage(content=state.assistant.llm.system_prompt),
            HumanMessage(
                content=(
                    f"The user approved the pending action and it has now been executed. "
                    f"Tool result: {result}\nReply with a brief confirmation of what was done "
                    f"(or, if the result shows a failure, say so plainly). Do not call any tools."
                )
            ),
        ]
        content = ""
        async for event in _stream_full_reply(summary_messages, tools=None):
            if event["type"] == "token":
                yield {"type": "token", "text": event["text"]}
            else:
                content = event["content"]
        history.append(AIMessage(content=content))
        yield {"type": "done", "text": content, "_delta": history[start_len:]}
        return

    if pending and _is_write_rejection(text):
        audit_log.clear_pending_approval(session_id)
        history.append(HumanMessage(content=text))
        cancel_text = "Okay, I've cancelled that — nothing was changed."
        history.append(AIMessage(content=cancel_text))
        audit_log.log_turn(session_id, "tool", cancel_text, tool_name=pending["tool_name"],
                           tool_args=pending["args"], user_id=user_id, prompt_text=text,
                           tool_status="rejected")
        yield {"type": "done", "text": cancel_text, "_delta": history[start_len:]}
        return

    if pending:
        audit_log.clear_pending_approval(session_id)

    history.append(HumanMessage(content=text))
    trimmed = trim_messages(
        history,
        max_tokens=MAX_HISTORY_TOKENS,
        token_counter=state._approx_tokens,
        strategy="last",
        include_system=False,
    )

    candidate_tools = []
    if state.ALL_TOOLS:
        candidate_tools = list(state.ALL_TOOLS) if len(state.ALL_TOOLS) <= TOOL_RAG_BYPASS_THRESHOLD else (state.tool_rag.retrieve(text) if state.tool_rag else [])

    openai_tools = None
    if candidate_tools:
        openai_tools = []
        for t in candidate_tools:
            formatted = convert_to_openai_tool(t)
            if "function" in formatted and "parameters" in formatted["function"]:
                formatted["function"]["parameters"] = _clean_schema_for_openai(formatted["function"]["parameters"])
            openai_tools.append(formatted)

    system_parts = [state.assistant.llm.system_prompt]
    if task_context:
        system_parts.append(f"\nCurrent task in progress: {task_context}.")
    call_messages = [SystemMessage(content="\n".join(system_parts)), *trimmed]

    max_rounds = 4
    try:
        for round_number in range(max_rounds + 1):
            content = ""
            tool_calls = []
            async for event in _stream_full_reply(call_messages, tools=openai_tools):
                if event["type"] == "token":
                    yield {"type": "token", "text": event["text"]}
                else:
                    content = event["content"]
                    tool_calls = event["tool_calls"]

            if not tool_calls:
                ai_msg = AIMessage(content=content)
                history.append(ai_msg)
                yield {"type": "done", "text": content, "_delta": history[start_len:]}
                return

            if round_number == max_rounds:
                break

            ai_msg = AIMessage(content=content, tool_calls=tool_calls)
            call_messages.append(ai_msg)
            history.append(ai_msg)
            for tc in tool_calls:
                yield {"type": "tool_call", "name": tc["name"], "args": tc.get("args") or {}}
                result = await _execute_tool(tc["name"], tc.get("args") or {}, session_id=session_id, user_id=user_id, prompt_text=text)
                yield {"type": "tool_result", "name": tc["name"], "result": result}
                t_msg = ToolMessage(content=str(result), tool_call_id=tc["id"])
                call_messages.append(t_msg)
                history.append(t_msg)

        content = ""
        async for event in _stream_full_reply(call_messages, tools=None):
            if event["type"] == "token":
                yield {"type": "token", "text": event["text"]}
            else:
                content = event["content"]
        ai_msg = AIMessage(content=content)
        history.append(ai_msg)
        yield {"type": "done", "text": content, "_delta": history[start_len:]}
    except asyncio.CancelledError:
        if history:
            last_msg = history[-1]
            if isinstance(last_msg, AIMessage) and getattr(last_msg, "tool_calls", None):
                history.pop()
            elif isinstance(last_msg, ToolMessage):
                tool_msg_count = 0
                for msg in reversed(history):
                    if isinstance(msg, ToolMessage):
                        tool_msg_count += 1
                    else:
                        break

                if len(history) > tool_msg_count:
                    ai_msg = history[-(tool_msg_count + 1)]
                    if isinstance(ai_msg, AIMessage) and getattr(ai_msg, "tool_calls", None):
                        if len(ai_msg.tool_calls) != tool_msg_count:
                            for _ in range(tool_msg_count + 1):
                                history.pop()
        raise
