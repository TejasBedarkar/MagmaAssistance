import base64
import os
import re
import shutil
import logging
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage, AIMessage, BaseMessage, trim_messages
from langchain_core.output_parsers import StrOutputParser
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatResult, ChatGeneration
from typing import List, Optional, Any, Sequence, Dict, Union, Callable, Annotated, TypedDict
import requests

from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver

from LLM.LLM import LLM
import audit_log

# Helper function to convert messages to dictionary format for the OpenAI API
def convert_message_to_dict(message):
    if isinstance(message, SystemMessage):
        return {"role": "system", "content": message.content}
    elif isinstance(message, HumanMessage):
        return {"role": "user", "content": message.content}
    elif isinstance(message, ToolMessage):
        return {"role": "tool", "tool_call_id": message.tool_call_id, "content": message.content}
    elif isinstance(message, AIMessage):
        d = {"role": "assistant", "content": message.content or ""}
        if message.tool_calls:
            d["tool_calls"] = []
            for tc in message.tool_calls:
                d["tool_calls"].append({
                    "id": tc.get("id"),
                    "type": "function",
                    "function": {
                        "name": tc.get("name"),
                        "arguments": json.dumps(tc.get("args") or {})
                    }
                })
        elif hasattr(message, "additional_kwargs") and "tool_calls" in message.additional_kwargs:
            d["tool_calls"] = message.additional_kwargs["tool_calls"]
        return d
    elif isinstance(message, dict):
        return message
    else:
        role = getattr(message, "type", "user")
        if role == "ai":
            role = "assistant"
        return {"role": role, "content": getattr(message, "content", str(message))}

class OpenAIChatModel(BaseChatModel):
    model_name: str
    temperature: float
    api_key: str
    base_url: str
    bound_tools: Optional[List[Any]] = None

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[Any] = None,
        **kwargs: Any,
    ) -> ChatResult:
        api_messages = [convert_message_to_dict(msg) for msg in messages]
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        data = {
            "model": self.model_name,
            "messages": api_messages,
            "temperature": self.temperature,
        }
        
        if self.bound_tools:
            data["tools"] = self.bound_tools
            
        response = requests.post(self.base_url, json=data, headers=headers)
        response.raise_for_status()
        res_json = response.json()
        
        choice = res_json["choices"][0]
        message_data = choice["message"]
        
        content = message_data.get("content") or ""
        tool_calls = []
        if "tool_calls" in message_data:
            for tc in message_data["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"])
                except Exception:
                    args = {}
                tool_calls.append({
                    "name": tc["function"]["name"],
                    "args": args,
                    "id": tc.get("id"),
                })
        
        ai_message = AIMessage(content=content, tool_calls=tool_calls)
        return ChatResult(generations=[ChatGeneration(message=ai_message)])

    def _llm_type(self) -> str:
        return "openai-chat-model"

    def bind_tools(
        self,
        tools: Sequence[Union[Dict[str, Any], type[BaseModel], Callable, Any]],
        **kwargs: Any,
    ) -> "OpenAIChatModel":
        from langchain_core.utils.function_calling import convert_to_openai_tool
        formatted_tools = [convert_to_openai_tool(t) for t in tools]
        return OpenAIChatModel(
            model_name=self.model_name,
            temperature=self.temperature,
            api_key=self.api_key,
            base_url=self.base_url,
            bound_tools=formatted_tools,
        )

# Add model property to LLM class before importing Main/VoiceAssistant
@property
def get_model(self):
    return OpenAIChatModel(
        model_name=self.model_name,
        temperature=self.temperature,
        api_key=self.api_key,
        base_url=self.base_url
    )

LLM.model = get_model

from Main import VoiceAssistant
from ERP.tool_rag import ToolRAG

from ERP.tools import ALL_TOOLS, ALL_REQUIRED_FIELDS, ALL_FIELD_PARSERS
from ERP.tools.mcp_tools import mcp_tool_source


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent-server")

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")
TTS_VOICE = os.environ.get("TTS_VOICE", "af_heart")

logger.info("Loading VoiceAssistant agent (Whisper=%s, LLM=%s)...", WHISPER_MODEL, LLM_MODEL)
assistant = VoiceAssistant(
    whisper_model=WHISPER_MODEL,
    llm_model=LLM_MODEL,
    tts_voice=TTS_VOICE,
    speak_replies=False,
)
text_chain = assistant.prompt | assistant.llm.model | StrOutputParser()


TOOL_RAG_TOP_K = int(os.environ.get("TOOL_RAG_TOP_K", "3"))
TOOL_RAG_MIN_SCORE = float(os.environ.get("TOOL_RAG_MIN_SCORE", "0.25"))

# Local ERP/tools/*.py tools are indexed synchronously at import time, same
# as before. MCP-sourced tools (ERP/mcp_server.py) can only be loaded async,
# so they're added on top of this in the lifespan startup handler below —
# tool_rag/tool_map are declared here and mutated (not replaced) there.
tool_rag = None
tool_map = {}
if ALL_TOOLS:
    logger.info("Indexing %d local ERP tool(s) for retrieval...", len(ALL_TOOLS))
    tool_rag = ToolRAG(ALL_TOOLS, top_k=TOOL_RAG_TOP_K, min_score=TOOL_RAG_MIN_SCORE)
    tool_map = {tool.name: tool for tool in ALL_TOOLS}
else:
    logger.info("No local ERP tools registered — continuing with MCP tools only, if any.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs once at server startup and once at shutdown (FastAPI lifespan
    protocol). On startup: spawns ERP/mcp_server.py as a subprocess over
    MCP's stdio transport (via mcp_tool_source, see ERP/tools/mcp_tools.py)
    and merges its tools into the same tool_rag/tool_map the local
    ERP/tools/*.py tools already use — so ToolRAG retrieval and
    _execute_tool work identically regardless of which source a tool came
    from. On shutdown: cleanly terminates that subprocess.
    """
    global tool_rag, tool_map

    try:
        mcp_tools = await mcp_tool_source.start()
        if mcp_tools:
            logger.info("Loaded %d MCP tool(s) from ERP/mcp_server.py", len(mcp_tools))
            if tool_rag:
                tool_rag.add_tools(mcp_tools)
            else:
                tool_rag = ToolRAG(mcp_tools, top_k=TOOL_RAG_TOP_K, min_score=TOOL_RAG_MIN_SCORE)
            tool_map.update({tool.name: tool for tool in mcp_tools})
        else:
            logger.warning("ERP MCP server started but reported zero tools.")
    except Exception:
        # Don't let a broken/missing MCP server take the whole API down —
        # fall back to whatever local ERP/tools/*.py tools are registered.
        logger.exception("Failed to start ERP MCP server — continuing with local tools only.")

    yield

    await mcp_tool_source.stop()


app = FastAPI(title="MagmaAssistance Backend", lifespan=lifespan)

# Allow CORS requests from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# ---------------------------------------------------------------------
# Memory: LangGraph state + checkpointer, keyed by session_id
# ---------------------------------------------------------------------
#
# Two layers, both persisted per session_id via a MemorySaver checkpointer
# (swap for SqliteSaver/Postgres if this needs to survive a restart):
#
# 1. SHORT-TERM MEMORY -- state["messages"], accumulated automatically by
#    the `add_messages` reducer. Previously each /api/chat call only sent
#    [SystemMessage, HumanMessage(text)] with zero memory of earlier turns
#    in the session; now the full conversation is kept in the checkpointer
#    and a trimmed window (MAX_HISTORY_MESSAGES) is sent to the LLM each
#    turn, so latency/cost stay flat as a session grows.
#
# 2. TASK-CONTEXT MEMORY -- state["current_task"], state["task_slots"],
#    state["pending_tool"], state["pending_missing"]. This replaces the old
#    global `_pending_actions` dict one-for-one for slot-filling (a
#    create/update tool call missing a required field opens a flow that
#    asks for each missing field across turns, exactly as before) and adds
#    on top of it: `current_task` is a short label kept alive across turns
#    of the SAME task and cleared only when a lightweight classifier
#    decides the user has switched topics. ToolRAG retrieval is queried
#    against "<task label>. <new message>" instead of the raw message
#    alone, which keeps retrieval accurate on short follow-ups ("what's
#    her phone number?") that wouldn't embed well on their own.
MAX_HISTORY_MESSAGES = 12  # messages, not tokens -- len() is used as the counter below


class ChatState(TypedDict):
    messages: Annotated[list, add_messages]
    current_task: Optional[str]
    task_slots: dict
    pending_tool: Optional[str]
    pending_missing: list  # ordered [(field, question), ...] still to collect
    session_id: str        # thread id, passed through so nodes can attribute audit_log entries


# Values a model sometimes invents in place of a real answer when it
# doesn't actually know one, instead of leaving the field blank so
# slot-filling can ask. Treated as "still missing" so a required field
# (e.g. company, warehouse) can't be silently satisfied by a guess.
_PLACEHOLDER_VALUES = {
    "default", "n/a", "na", "none", "null", "unknown",
    "not specified", "not sure", "unspecified", "todo", "tbd", "-",
}


def _missing_fields(tool_name: str, args: dict) -> list:
    """Ordered (field, question) pairs required for `tool_name` that are
    absent, empty, or filled with a placeholder-like guess in `args`."""
    required = ALL_REQUIRED_FIELDS.get(tool_name, [])
    args = args or {}
    missing = []
    for field, question in required:
        value = args.get(field)
        if not value:
            missing.append((field, question))
        elif isinstance(value, str) and value.strip().lower() in _PLACEHOLDER_VALUES:
            missing.append((field, question))
    return missing


def _last_human_message(messages) -> Optional[str]:
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            return m.content
    return None


def _parse_json_loose(text: str) -> dict:
    """Classifier replies sometimes get ```json-fenced despite instructions
    not to -- strip that before parsing instead of failing outright."""
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())


def _flatten_scalar(value):
    """Some local models (llama3.2 and similar) occasionally wrap a plain
    scalar argument in a dict instead of passing it directly — e.g.
    {'name': 'Negotiation'} instead of just 'Negotiation' for a `stage:
    str` field. Pydantic then rejects the call outright with a
    string_type/int_type error and the whole tool call is lost. This
    unwraps that: single-key dicts use their one value, dicts with a
    recognizable wrapper key (value/name/text/input) use that key, and
    anything else falls back to a string representation rather than
    failing. Recurses in case of double-wrapping."""
    if isinstance(value, dict):
        if len(value) == 1:
            return _flatten_scalar(next(iter(value.values())))
        for key in ("value", "name", "text", "input"):
            if key in value:
                return _flatten_scalar(value[key])
        return str(value)
    return value


def _sanitize_tool_args(tool_name: str, args: dict) -> dict:
    if not args:
        return args

    tool = tool_map.get(tool_name)
    schema = getattr(tool, "args_schema", None)
    fields = getattr(schema, "model_fields", None) if schema else None
    if not fields:
        return args

    cleaned = dict(args)

    for field_name, field_info in fields.items():
        if field_name not in cleaned:
            continue

        value = cleaned[field_name]

        annotation = field_info.annotation
        inner_types = [
            t for t in getattr(annotation, "__args__", [annotation])
            if t is not type(None)
        ]

        expects_scalar = any(
            t in (str, int, float, bool)
            for t in inner_types
        )

        # Existing dict unwrapping
        if isinstance(value, dict) and expects_scalar:
            value = _flatten_scalar(value)
            cleaned[field_name] = value

        # NEW: remove empty strings for numeric fields
        if value == "":
            if int in inner_types or float in inner_types:
                cleaned.pop(field_name, None)

    return cleaned


async def _execute_tool(tool_name: str, args: dict, session_id: Optional[str] = None):
    """Async because MCP-sourced tools (ERP/mcp_server.py, loaded via
    ERP/tools/mcp_tools.py) only implement `.ainvoke()`, not the sync
    `.invoke()`. This works transparently for the existing local
    ERP/tools/*.py tools too — LangChain's BaseTool.ainvoke() runs a sync
    tool's normal invoke() under the hood when no native async
    implementation exists, so no other tool code needed to change.

    Every call is written to the audit log (session_id, tool, args,
    result) regardless of success — this is the one choke point all tool
    execution passes through, so it's the cheapest place to record "what
    actions did the agent actually take" for later review."""
    tool = tool_map.get(tool_name)
    if tool is None:
        result = f"Tool '{tool_name}' is not available."
        if session_id:
            audit_log.log_turn(session_id, "tool", result, tool_name=tool_name, tool_args=args)
        return result
    try:
        result = await tool.ainvoke(_sanitize_tool_args(tool_name, args) or {})
        if session_id:
            audit_log.log_turn(session_id, "tool", str(result), tool_name=tool_name, tool_args=args)
        return result
    except Exception:
        logger.exception("Tool '%s' failed", tool_name)
        failure = f"'{tool_name}' failed to fetch ERP data right now."
        if session_id:
            audit_log.log_turn(session_id, "tool", failure, tool_name=tool_name, tool_args=args)
        return failure


_FAKE_NAME_RE = re.compile(r'"name"\s*:\s*"(?P<name>[a-zA-Z_][\w\-.]*)"')
_FAKE_KV_STR_RE = re.compile(r'"(?P<key>[a-zA-Z_]\w*)"\s*:\s*"(?P<value>(?:[^"\\]|\\.)*)"')
_FAKE_KV_NUM_RE = re.compile(r'"(?P<key>[a-zA-Z_]\w*)"\s*:\s*(?P<value>-?\d+(?:\.\d+)?)\b')


def _extract_fake_tool_call(content: str):
    """Some local models via Ollama (llama3.2 and similar) occasionally
    reply with a plain-text approximation of a tool call instead of using
    the real function-calling protocol, e.g.:
        {"name":"create_customer","parameters={"lead_id":"","customer_name":"Sujay"}}
    This is often broken well beyond a single typo — note the missing
    colon/closing quote around "parameters" above, which means the
    "parameters" value isn't even a validly nested object, so a strict
    brace-matching parse won't survive it either. Rather than trying to
    fully parse the structure, this pulls out the tool name, then scrapes
    any "key":"value" or "key":123 pairs found anywhere after it — good
    enough to recover the user's actual intent from what is essentially
    a hallucinated shape. Returns None if `content` doesn't look like an
    attempted tool call, or names a tool that doesn't exist.
    """
    text = (content or "").strip()
    if not text.startswith("{") or '"name"' not in text or "parameters" not in text.lower():
        return None

    name_match = _FAKE_NAME_RE.search(text)
    if not name_match:
        return None

    name = name_match.group("name")
    if name not in tool_map:
        return None

    # Only look at text after "parameters" so we don't re-capture "name"
    # itself as if it were an argument.
    params_idx = text.lower().find("parameters")
    tail = text[params_idx:] if params_idx != -1 else text

    args = {}
    for m in _FAKE_KV_STR_RE.finditer(tail):
        args.setdefault(m.group("key"), m.group("value"))
    for m in _FAKE_KV_NUM_RE.finditer(tail):
        key = m.group("key")
        if key in args:
            continue
        value = m.group("value")
        args[key] = float(value) if "." in value else int(value)

    if not args:
        return None

    return {"name": name, "args": args, "id": "fake-tool-call-0"}


_CLASSIFY_SYSTEM = (
    "You track whether a new user message continues the SAME task as before, "
    "or starts a NEW, unrelated task, for an ERP sales assistant.\n"
    "Reply with ONLY a compact JSON object, nothing else: "
    '{"same_task": true|false, "task_label": "<3-6 word label for the CURRENT task after this message>"}\n'
    "Rules:\n"
    "- A follow-up about the same record/order/lead/customer, or the user "
    "supplying info the assistant just asked for, is the SAME task.\n"
    "- A greeting, thanks, or closing remark right after a task is finished "
    "does NOT start a new task; keep same_task=true with the same label.\n"
    "- A request about a different customer/record/action/topic is a NEW task."
)


def intake_node(state: ChatState) -> dict:
    """If a slot-filling flow is open (pending_tool set), this turn's
    message is the answer to the next missing field — merge it in and
    either ask the next question or hand off to execute_pending once the
    record is complete. Otherwise, no-op and fall through to classify_task."""
    pending_tool = state.get("pending_tool")
    pending_missing = state.get("pending_missing") or []
    if not pending_tool or not pending_missing:
        return {}

    last_user_msg = _last_human_message(state["messages"]) or ""
    field, _question = pending_missing[0]
    parser = ALL_FIELD_PARSERS.get((pending_tool, field))
    value = parser(last_user_msg) if parser else last_user_msg.strip()

    slots = {**(state.get("task_slots") or {}), field: value}
    remaining = pending_missing[1:]

    if remaining:
        return {
            "task_slots": slots,
            "pending_missing": remaining,
            "messages": [AIMessage(content=remaining[0][1])],
        }

    # All required fields collected -- clear the queue so the router sends
    # this to execute_pending. pending_tool/task_slots stay set until the
    # tool call actually runs (execute_pending clears them after).
    return {"task_slots": slots, "pending_missing": []}


def _route_after_intake(state: ChatState) -> str:
    if state.get("pending_tool"):
        return END if state.get("pending_missing") else "execute_pending"
    return "classify_task"


def classify_task_node(state: ChatState) -> dict:
    """Task-context memory: keeps `current_task` alive across turns of the
    same task, and only resets it when the topic genuinely changes."""
    last_user_msg = _last_human_message(state["messages"])
    if last_user_msg is None:
        return {}

    current_task = state.get("current_task")
    if current_task is None:
        return {"current_task": last_user_msg[:60]}

    prompt = f"Active task: {current_task}\nNew user message: {last_user_msg}"
    try:
        resp = assistant.llm.model.invoke(
            [SystemMessage(content=_CLASSIFY_SYSTEM), HumanMessage(content=prompt)]
        )
        parsed = _parse_json_loose(resp.content)
        same_task = bool(parsed.get("same_task"))
        task_label = parsed.get("task_label") or current_task
    except Exception as exc:  # noqa: BLE001
        # Fail safe toward continuity rather than losing progress over a
        # transient classification error.
        logger.warning("Task classification failed (%s); assuming same task.", exc)
        same_task, task_label = True, current_task

    return {"current_task": task_label}


async def agent_node(state: ChatState) -> dict:
    """Retrieve-tools -> call-LLM -> call-tool turn, same logic as the
    original generate_reply, now working off the trimmed short-term
    history instead of a single isolated message, and opening a
    slot-filling flow (via state) instead of a global dict when a
    write-tool call is missing required info."""
    last_user_msg = _last_human_message(state["messages"]) or ""
    task_context = state.get("current_task")

    history = trim_messages(
        state["messages"],
        max_tokens=MAX_HISTORY_MESSAGES,
        token_counter=len,  # counts messages, not tokens -- a cheap, adequate proxy here
        strategy="last",
        include_system=False,
    )

    if not tool_rag:
        reply = text_chain.invoke({"input": last_user_msg})
        return {"messages": [AIMessage(content=reply)]}

    retrieval_query = f"{task_context}. {last_user_msg}" if task_context else last_user_msg
    candidate_tools = tool_rag.retrieve(retrieval_query)
    if not candidate_tools:
        reply = text_chain.invoke({"input": last_user_msg})
        return {"messages": [AIMessage(content=reply)]}

    logger.info("Tools selected for query: %s", [t.name for t in candidate_tools])

    llm_with_tools = assistant.llm.model.bind_tools(candidate_tools)
    system_parts = [assistant.llm.system_prompt]
    if task_context:
        system_parts.append(f"\nCurrent task in progress: {task_context}.")
    call_messages = [SystemMessage(content="\n".join(system_parts)), *history]

    response = llm_with_tools.invoke(call_messages)

    tool_calls = response.tool_calls
    is_recovered = False
    if not tool_calls:
        recovered = _extract_fake_tool_call(response.content)
        if not recovered:
            return {"messages": [response]}
        logger.warning(
            "Model returned a text-shaped fake tool call instead of a real "
            "one; recovered '%s' from it: %s", recovered["name"], recovered["args"]
        )
        tool_calls = [recovered]
        is_recovered = True

    call_messages.append(response)

    # If a write-tool call is missing required info, open a slot-filling
    # flow instead of calling it or letting the model guess a value. Only
    # one flow runs at a time, so the first offending call wins.
    for tool_call in tool_calls:
        tool_name = tool_call["name"]
        if tool_name in ALL_REQUIRED_FIELDS:
            args = _sanitize_tool_args(tool_name, tool_call.get("args") or {})
            missing = _missing_fields(tool_name, args)
            if missing:
                return {
                    "current_task": task_context or f"{tool_name} for {last_user_msg[:40]}",
                    "pending_tool": tool_name,
                    "task_slots": args,
                    "pending_missing": missing,
                    "messages": [AIMessage(content=missing[0][1])],
                }

    results = []
    for tool_call in tool_calls:
        result = await _execute_tool(tool_call["name"], tool_call.get("args") or {}, session_id=state.get("session_id"))
        logger.info("Tool '%s' raw result: %s", tool_call["name"], result)
        results.append((tool_call, result))

    if not is_recovered:
        # Real tool calls: thread the results back in as ToolMessages and
        # let the model compose the final reply. Only the final text is
        # persisted to short-term memory -- the intermediate tool-call
        # message isn't, so a later trimmed window never ships an
        # orphaned tool_call without its ToolMessage alongside it.
        for tool_call, result in results:
            call_messages.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))
        final_response = llm_with_tools.invoke(call_messages)
        return {"messages": [final_response]}

    # Recovered fake tool call: there's no real AIMessage.tool_calls entry
    # to attach a ToolMessage to. Summarize the result directly instead —
    # same approach used to close out a slot-filling flow.
    summary_prompt = "\n".join(
        f"The '{tc['name']}' tool was just called with {tc.get('args')} and returned: {result}"
        for tc, result in results
    ) + "\nGive the user a short, professional confirmation (1-2 sentences)."
    summary = text_chain.invoke({"input": summary_prompt})
    return {"messages": [AIMessage(content=summary)]}


async def execute_pending_node(state: ChatState) -> dict:
    """Runs the write tool once every required field has been collected
    across turns, then clears the slot-filling state (current_task is
    kept, so a follow-up like 'thanks' still resolves against it)."""
    tool_name = state["pending_tool"]
    args = state.get("task_slots") or {}

    result = await _execute_tool(tool_name, args, session_id=state.get("session_id"))
    logger.info("Tool '%s' raw result: %s", tool_name, result)

    summary_prompt = (
        f"The '{tool_name}' tool was just called with {args} and returned: {result}\n"
        "Give the user a short, professional confirmation (1-2 sentences)."
    )
    summary = text_chain.invoke({"input": summary_prompt})

    return {
        "messages": [AIMessage(content=summary)],
        "pending_tool": None,
        "task_slots": {},
        "pending_missing": [],
    }


def build_agent_graph(checkpointer=None):
    graph = StateGraph(ChatState)
    graph.add_node("intake", intake_node)
    graph.add_node("classify_task", classify_task_node)
    graph.add_node("agent", agent_node)
    graph.add_node("execute_pending", execute_pending_node)

    graph.set_entry_point("intake")
    graph.add_conditional_edges(
        "intake", _route_after_intake, {END: END, "execute_pending": "execute_pending", "classify_task": "classify_task"}
    )
    graph.add_edge("classify_task", "agent")
    graph.add_edge("agent", END)
    graph.add_edge("execute_pending", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())


# Built once at import time; nodes read `tool_rag`/`tool_map` as globals at
# call time, so they still pick up the MCP tools merged in during the
# FastAPI lifespan startup handler above, without needing to rebuild this.
agent_graph = build_agent_graph()


async def generate_reply(text: str, session_id: str = "default") -> str:
    """Returns the assistant's reply text for a user message.

    `session_id` is a LangGraph checkpointer thread_id: it carries the
    full conversation (short-term memory) and the current task label /
    any open slot-filling flow (task-context memory) across calls, in
    place of the old global `_pending_actions` dict.

    Separately, every user message, assistant reply, and tool action for
    this session is written to `audit_log` (SQLite, durable across
    restarts) so a company can pull up exactly what was discussed and
    done in any session later — see /api/audit/sessions below.
    """
    audit_log.log_turn(session_id, "user", text)

    config = {"configurable": {"thread_id": session_id}}
    result = await agent_graph.ainvoke(
        {"messages": [HumanMessage(content=text)], "session_id": session_id}, config
    )
    reply = result["messages"][-1].content

    audit_log.log_turn(session_id, "assistant", reply)
    return reply

def _get_tts_audio(text: str):
    """Synthesizes `text` to a WAV file and returns its raw bytes, or None
    if synthesis failed. Mirrors the old Flask backend's TTS step."""
    wav_path = assistant.tts.synthesize_to_file(text)
    try:
        with open(wav_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass

class ChatRequest(BaseModel):
    message: str

    session_id: str = "default"

@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Restored old-style JSON contract: { message } in, { reply, audio } out.
    `session_id` is optional and only matters if you want independent
    slot-filling conversations for multiple users; a single local user can
    ignore it and let it default."""

    text = (req.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="message is required")

    try:
        reply = await generate_reply(text, req.session_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Agent failed to process message: %s", text)
        raise HTTPException(status_code=500, detail=str(exc))

    audio_b64 = None
    try:
        wav_bytes = _get_tts_audio(reply)
        if wav_bytes:
            audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
    except Exception:
        logger.exception("TTS step failed; returning text-only reply")

    return {"reply": reply, "audio": audio_b64}

@app.post("/query")
async def handle_query(
    query: str = Form(None),

    file: UploadFile = File(None),
    session_id: str = Form("default"),

):
    """Exposes endpoint to query MagmaAssistance using either text or audio files."""
    if not query and not file:
        raise HTTPException(status_code=400, detail="Either 'query' (text) or 'file' (audio) must be provided.")

    query_text = ""

    # 1. Handle Audio input (STT using Whisper)
    if file:
        temp_dir = "temp"
        os.makedirs(temp_dir, exist_ok=True)
        temp_file_path = os.path.join(temp_dir, file.filename)
        try:
            with open(temp_file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            logger.info(f"Saved uploaded audio file to {temp_file_path}")
            
            # Transcribe audio file to text
            query_text = assistant.whisper.transcribe_file(temp_file_path)
            logger.info(f"Transcribed Audio Text: {query_text}")
        except Exception as e:
            logger.error(f"Error handling uploaded file: {e}")
            raise HTTPException(status_code=500, detail=f"Error transcribing audio file: {e}")
        finally:
            # Clean up temp file
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
    else:
        query_text = query

    # 2. Get response from MagmaAssistance agent
    logger.info(f"Processing query: '{query_text}'")
    response_text = await generate_reply(query_text, session_id)

    # 3. Synthesize the reply to speech too, same as /api/chat, so the
    # frontend has something to play regardless of which endpoint it uses.
    audio_b64 = None
    try:
        wav_bytes = _get_tts_audio(response_text)
        if wav_bytes:
            audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
    except Exception:
        logger.exception("TTS step failed; returning text-only reply")

    return {
        "query": query_text,
        "response": response_text,
        "audio": audio_b64,

    }

@app.get("/api/audit/sessions")
def list_audit_sessions(since: str = None, limit: int = 100):
    """Session index for an audit dashboard: one row per session_id with
    turn count and first/last activity. `since` (optional) filters to
    sessions active on/after an ISO date, e.g. ?since=2026-07-01."""
    return {"sessions": audit_log.list_sessions(since=since, limit=limit)}


@app.get("/api/audit/sessions/{session_id}")
def get_audit_transcript(session_id: str):
    """Full ordered transcript for one session: every user message,
    assistant reply, and tool action taken, as JSON."""
    transcript = audit_log.get_transcript(session_id)
    if not transcript:
        raise HTTPException(status_code=404, detail=f"No audit log found for session '{session_id}'")
    return {"session_id": session_id, "turn_count": len(transcript), "transcript": transcript}


@app.get("/api/audit/export")
def export_audit_json(session_id: str = None):
    """Downloads the audit log as a .json file — one session if
    `session_id` is given, otherwise every session on record."""
    export_dir = "audit_exports"
    os.makedirs(export_dir, exist_ok=True)
    filename = f"audit_{session_id}.json" if session_id else "audit_all_sessions.json"
    path = os.path.join(export_dir, filename)
    audit_log.write_json_export(path, session_id=session_id)

    from fastapi.responses import FileResponse
    return FileResponse(path, media_type="application/json", filename=filename)


@app.get("/api/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8050))
    logger.info(f"Starting server on port {port}...")

    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)