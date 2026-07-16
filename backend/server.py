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
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage, AIMessage, BaseMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatResult, ChatGeneration
from typing import List, Optional, Any, Sequence, Dict, Union, Callable
import requests

from LLM.LLM import LLM

# Helper function to convert messages to dictionary format for OpenRouter API
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

class OpenRouterChatModel(BaseChatModel):
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
            "HTTP-Referer": "https://github.com/GoogleCloudPlatform",
            "X-Title": "MagmaAssistance",
        }
        
        # Translate default model name to free OpenRouter model
        model_to_use = self.model_name
        if model_to_use == "llama3.2":
            model_to_use = "nvidia/nemotron-3-ultra-550b-a55b:free"
            
        data = {
            "model": model_to_use,
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
        return "openrouter-chat-model"

    def bind_tools(
        self,
        tools: Sequence[Union[Dict[str, Any], type[BaseModel], Callable, Any]],
        **kwargs: Any,
    ) -> "OpenRouterChatModel":
        from langchain_core.utils.function_calling import convert_to_openai_tool
        formatted_tools = [convert_to_openai_tool(t) for t in tools]
        return OpenRouterChatModel(
            model_name=self.model_name,
            temperature=self.temperature,
            api_key=self.api_key,
            base_url=self.base_url,
            bound_tools=formatted_tools,
        )

# Add model property to LLM class before importing Main/VoiceAssistant
@property
def get_model(self):
    return OpenRouterChatModel(
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
LLM_MODEL = os.environ.get("LLM_MODEL", "llama3.2")
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
# Slot-filling: in-memory per-session state
# ---------------------------------------------------------------------
#
# When the agent wants to call a create/update tool listed in
# ALL_REQUIRED_FIELDS but is missing one of its required fields, it
# doesn't call the tool or let the model fabricate a value. Instead it
# opens a "pending action" for that session and asks for the missing
# fields one at a time across turns, merging each answer into the args
# until the record is complete — then runs the tool for real.
#
# Keyed by session_id (the frontend can pass one; defaults to "default"
# for the common single-user case). This is in-memory only and resets on
# server restart, which is fine for a local assistant like this one.
_pending_actions: dict = {}


def _missing_fields(tool_name: str, args: dict) -> list:
    """Ordered (field, question) pairs required for `tool_name` that are
    absent or empty in `args`."""
    required = ALL_REQUIRED_FIELDS.get(tool_name, [])
    args = args or {}
    return [(field, question) for field, question in required if not args.get(field)]


def _start_pending_action(session_id: str, tool_name: str, args: dict, missing: list) -> str:
    """Opens a slot-filling flow for this session and returns the first
    question to ask the user."""
    _pending_actions[session_id] = {
        "tool": tool_name,
        "args": dict(args or {}),
        "missing": list(missing),
    }
    return missing[0][1]


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


async def _execute_tool(tool_name: str, args: dict):
    """Async because MCP-sourced tools (ERP/mcp_server.py, loaded via
    ERP/tools/mcp_tools.py) only implement `.ainvoke()`, not the sync
    `.invoke()`. This works transparently for the existing local
    ERP/tools/*.py tools too — LangChain's BaseTool.ainvoke() runs a sync
    tool's normal invoke() under the hood when no native async
    implementation exists, so no other tool code needed to change."""
    tool = tool_map.get(tool_name)
    if tool is None:
        return f"Tool '{tool_name}' is not available."
    try:
        return await tool.ainvoke(_sanitize_tool_args(tool_name, args) or {})
    except Exception:
        logger.exception("Tool '%s' failed", tool_name)
        return f"'{tool_name}' failed to fetch ERP data right now."


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


async def generate_reply(text: str, session_id: str = "default") -> str:
    """Returns the assistant's reply text for a user message.

    If this session has an open slot-filling flow (a create/update call
    that was missing required fields), this turn's message is treated as
    the answer to the next missing field. Otherwise it runs the normal
    retrieve-tools -> call-LLM -> call-tool loop, opening a slot-filling
    flow instead of calling the tool if a write-tool call comes back
    missing required info.
    """

    # --- Continue an open slot-filling flow ---
    pending = _pending_actions.get(session_id)
    if pending:
        field, _question = pending["missing"].pop(0)
        parser = ALL_FIELD_PARSERS.get((pending["tool"], field))
        pending["args"][field] = parser(text) if parser else text.strip()

        if pending["missing"]:
            # Still more required fields to collect — ask the next one.
            return pending["missing"][0][1]

        # All required fields collected — run the tool now.
        tool_name = pending["tool"]
        args = pending["args"]
        del _pending_actions[session_id]

        result = await _execute_tool(tool_name, args)
        logger.info("Tool '%s' raw result: %s", tool_name, result)
        summary_prompt = (
            f"The '{tool_name}' tool was just called with {args} and returned: {result}\n"
            "Give the user a short, professional confirmation (1-2 sentences)."
        )
        return text_chain.invoke({"input": summary_prompt})


    if not tool_rag:
        return text_chain.invoke({"input": text})

    candidate_tools = tool_rag.retrieve(text)
    if not candidate_tools:
        return text_chain.invoke({"input": text})

    logger.info("Tools selected for query: %s", [t.name for t in candidate_tools])

    llm_with_tools = assistant.llm.model.bind_tools(candidate_tools)
    messages = [
        SystemMessage(content=assistant.llm.system_prompt),
        HumanMessage(content=text),
    ]

    response = llm_with_tools.invoke(messages)

    tool_calls = response.tool_calls
    if not tool_calls:
        recovered = _extract_fake_tool_call(response.content)
        if not recovered:
            return response.content
        logger.warning(
            "Model returned a text-shaped fake tool call instead of a real "
            "one; recovered '%s' from it: %s", recovered["name"], recovered["args"]
        )
        tool_calls = [recovered]

    messages.append(response)

    # --- If a write-tool call is missing required info, ask instead of
    # calling it or letting the model guess a value. Only one form-filling
    # flow runs at a time, so the first offending call wins. ---
    for tool_call in tool_calls:
        tool_name = tool_call["name"]
        if tool_name in ALL_REQUIRED_FIELDS:
            args = _sanitize_tool_args(tool_name, tool_call.get("args") or {})
            missing = _missing_fields(tool_name, args)
            if missing:
                return _start_pending_action(session_id, tool_name, args, missing)

    results = []
    for tool_call in tool_calls:
        result = await _execute_tool(tool_call["name"], tool_call.get("args") or {})
        logger.info("Tool '%s' raw result: %s", tool_call["name"], result)
        results.append((tool_call, result))

    if response.tool_calls:
        # Real tool calls: thread the results back in as ToolMessages and
        # let the model compose the final reply, as normal.
        for tool_call, result in results:
            messages.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))
        final_response = llm_with_tools.invoke(messages)
        return final_response.content

    # Recovered fake tool call: there's no real AIMessage.tool_calls entry
    # to attach a ToolMessage to, so continuing this message list risks
    # confusing the model further. Summarize the result directly instead
    # — same approach used to close out a slot-filling flow.
    summary_prompt = "\n".join(
        f"The '{tc['name']}' tool was just called with {tc.get('args')} and returned: {result}"
        for tc, result in results
    ) + "\nGive the user a short, professional confirmation (1-2 sentences)."
    return text_chain.invoke({"input": summary_prompt})

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

@app.get("/api/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8050))
    logger.info(f"Starting server on port {port}...")

    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)

