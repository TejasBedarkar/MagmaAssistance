import base64
import os
import shutil
import logging
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.output_parsers import StrOutputParser

from Main import VoiceAssistant
from ERP.tool_rag import ToolRAG

from ERP.tools import ALL_TOOLS, ALL_REQUIRED_FIELDS, ALL_FIELD_PARSERS


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent-server")

app = FastAPI(title="MagmaAssistance Backend")

# Allow CORS requests from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

tool_rag = None
tool_map = {}
if ALL_TOOLS:
    logger.info("Indexing %d ERP tool(s) for retrieval...", len(ALL_TOOLS))
    tool_rag = ToolRAG(ALL_TOOLS, top_k=TOOL_RAG_TOP_K, min_score=TOOL_RAG_MIN_SCORE)
    tool_map = {tool.name: tool for tool in ALL_TOOLS}
else:
    logger.info("No ERP tools registered yet — running LLM-only.")



def _sanitize_tool_args(args: dict) -> dict:
    raw = dict(args or {})
    cleaned = {}
    stray = {}
    for key, value in raw.items():
        if isinstance(value, dict):
            if set(value.keys()) == {"value"}:
                cleaned[key] = value["value"]
            else:
                logger.warning(...)
                stray.update(value)
        else:
            cleaned[key] = value
    for key, value in stray.items():
        if key not in cleaned and value not in (None, ""):
            cleaned[key] = value
    return cleaned

def generate_reply(text: str) -> str:
    """Returns the assistant's reply text for a user message."""

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
    """Unwraps any dict-wrapped scalar in `args` for fields that the
    tool's schema expects to be a plain str/int/float/bool, using the
    tool's own pydantic args_schema to know which fields are scalar vs.
    genuinely list/dict (e.g. a quotation's `items`, which should stay a
    list of dicts and is left untouched)."""
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
        if not isinstance(value, dict):
            continue

        annotation = field_info.annotation
        inner_types = [
            t for t in getattr(annotation, "__args__", [annotation]) if t is not type(None)
        ]
        expects_scalar = any(t in (str, int, float, bool) for t in inner_types)

        if expects_scalar:
            cleaned[field_name] = _flatten_scalar(value)

    return cleaned


def _execute_tool(tool_name: str, args: dict):
    tool = tool_map.get(tool_name)
    if tool is None:
        return f"Tool '{tool_name}' is not available."
    try:
        return tool.invoke(_sanitize_tool_args(tool_name, args) or {})
    except Exception:
        logger.exception("Tool '%s' failed", tool_name)
        return f"'{tool_name}' failed to fetch ERP data right now."


def generate_reply(text: str, session_id: str = "default") -> str:
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

        result = _execute_tool(tool_name, args)
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

    if not response.tool_calls:
        return response.content


    messages.append(response)

    for tool_call in response.tool_calls:
        tool = tool_map.get(tool_call["name"])
        if tool is None:
            result = f"Tool '{tool_call['name']}' is not available."
        else:
            try:
                args = _sanitize_tool_args(tool_call.get("args"))
                result = tool.invoke(args)
            except Exception:
                logger.exception("Tool '%s' failed", tool_call["name"])
                result = f"'{tool_call['name']}' failed to fetch ERP data right now."


    # --- If a write-tool call is missing required info, ask instead of
    # calling it or letting the model guess a value. Only one form-filling
    # flow runs at a time, so the first offending call wins. ---
    for tool_call in response.tool_calls:
        tool_name = tool_call["name"]
        if tool_name in ALL_REQUIRED_FIELDS:
            args = _sanitize_tool_args(tool_name, tool_call.get("args") or {})
            missing = _missing_fields(tool_name, args)
            if missing:
                return _start_pending_action(session_id, tool_name, args, missing)

    messages.append(response)

    for tool_call in response.tool_calls:
        result = _execute_tool(tool_call["name"], tool_call.get("args") or {})

        messages.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))

    final_response = llm_with_tools.invoke(messages)
    return final_response.content

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
        reply = generate_reply(text, req.session_id)
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
    response_text = generate_reply(query_text, session_id)

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

