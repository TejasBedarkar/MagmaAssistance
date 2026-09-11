import asyncio
import base64
import os
import re
import shutil
import logging
import json
import sys
import httpx
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage, AIMessage, BaseMessage, trim_messages
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatResult, ChatGeneration
from typing import List, Optional, Any, Sequence, Dict, Union, Callable
import requests
import sqlite3

from LLM.LLM import LLM
import db.postgres_audit_log as audit_log
from storage import s3_storage
from ERP.erp_client import erp_client, ERPIdentity, use_identity

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

def _clean_schema_for_openai(schema: dict) -> dict:
    """Cleans up tool JSON schemas so OpenAI API does not throw 400 errors."""
    if not isinstance(schema, dict):
        return schema
    
    cleaned = schema.copy()
    # Remove fields that cause OpenAI strict parameter 400 validation failures
    cleaned.pop("additionalProperties", None)
    cleaned.pop("title", None)

    if "properties" in cleaned and isinstance(cleaned["properties"], dict):
        new_props = {}
        for prop_key, prop_val in cleaned["properties"].items():
            if isinstance(prop_val, dict):
                new_props[prop_key] = _clean_schema_for_openai(prop_val)
            else:
                new_props[prop_key] = prop_val
        cleaned["properties"] = new_props

    if "items" in cleaned and isinstance(cleaned["items"], dict):
        cleaned["items"] = _clean_schema_for_openai(cleaned["items"])

    return cleaned


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
        openrouter_key = os.environ.get("OPENROUTER_API_KEY")
        env_openai_key = os.environ.get("OPENAI_API_KEY")
        key = openrouter_key or self.api_key or env_openai_key

        is_openrouter = bool(openrouter_key) or (key and str(key).startswith("sk-or-v1-")) or "openrouter.ai" in str(self.base_url)

        if is_openrouter:
            headers = {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:8050",
                "X-Title": "MagmaAssistance",
            }
            target_url = "https://openrouter.ai/api/v1/chat/completions"
            model_name = self.model_name if "/" in self.model_name else f"openai/{self.model_name}"
        else:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
            target_url = self.base_url
            model_name = self.model_name

        data = {
            "model": model_name,
            "messages": api_messages,
            "temperature": self.temperature,
            "max_tokens": LLM_MAX_TOKENS,
        }
        
        if self.bound_tools:
            data["tools"] = self.bound_tools

        # If the model hits LLM_MAX_TOKENS mid-reply (finish_reason ==
        # "length"), ask it to continue from where it left off instead
        # of returning the truncated text as if it were the full
        # answer. Tool-call replies are never continued this way --
        # a tool call is either complete or it isn't, and re-prompting
        # risks a duplicate/garbled call.
        content = ""
        tool_calls = []
        message_data = {}
        for round_number in range(MAX_COMPLETION_ROUNDS + 1):
            try:
                response = requests.post(target_url, json=data, headers=headers, timeout=LLM_REQUEST_TIMEOUT_SECONDS)
            except requests.exceptions.Timeout:
                logger.error(
                    "LLM API call timed out after %ss with no response (%s)",
                    LLM_REQUEST_TIMEOUT_SECONDS, target_url,
                )
                raise RuntimeError(
                    f"The AI model didn't respond within {int(LLM_REQUEST_TIMEOUT_SECONDS)}s. "
                    "Please try again."
                )

            if not response.ok:
                logger.error(f"LLM API Rejected Request ({response.status_code}): {response.text}")

            response.raise_for_status()
            res_json = response.json()

            choice = res_json["choices"][0]
            message_data = choice["message"]
            finish_reason = choice.get("finish_reason")

            piece = message_data.get("content") or ""
            content += piece

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

            if finish_reason != "length" or tool_calls or round_number == MAX_COMPLETION_ROUNDS:
                if finish_reason == "length":
                    logger.warning(
                        "LLM reply still truncated after %d continuation round(s); "
                        "returning what we have.", round_number
                    )
                break

            # Continue the truncated reply: replay what the model said so
            # far as an assistant turn, then ask it to pick up exactly
            # where it stopped.
            data = dict(data)
            data["messages"] = api_messages + [
                {"role": "assistant", "content": piece},
                {"role": "user", "content": "Continue exactly where you left off. Do not repeat any text or restart the answer."},
            ]

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
        
        formatted_tools = []
        for t in tools:
            formatted = convert_to_openai_tool(t)
            # Sanitize tool parameter schema to fix 400 Bad Request
            if "function" in formatted and "parameters" in formatted["function"]:
                formatted["function"]["parameters"] = _clean_schema_for_openai(
                    formatted["function"]["parameters"]
                )
            formatted_tools.append(formatted)

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

# Migrated to the single generic ERP_Unified.erp_data_tool gateway —
# the old per-doctype tools (ERP/tools/*.py's create_lead, update_lead,
# etc.) are no longer registered; erp_data_tool does its own
# missing-field prompting internally via ERP.dynamic_fields, keyed by
# session_id instead of by tool name.
from ERP_Unified.tools import ERP_UNIFIED_TOOLS, pending_web_review_doctype
from ERP.tools.DashboardUI_tools import DASHBOARD_UI_TOOLS
from web.web_tool import WEB_TOOLS

ALL_TOOLS = [*ERP_UNIFIED_TOOLS, *DASHBOARD_UI_TOOLS, *WEB_TOOLS]


# Configure logging
# Global log level: INFO for most modules; DEBUG for voice pipeline modules
# so STT/TTS timing, byte counts and WebSocket lifecycle are fully visible.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
for _voice_logger in ("ws_voice", "openai-stt", "openai-tts"):
    logging.getLogger(_voice_logger).setLevel(logging.DEBUG)

logger = logging.getLogger("agent-server")

# ---------------------------------------------------------------------
# LangSmith tracing (optional -- no-op if LANGCHAIN_API_KEY isn't set)
# ---------------------------------------------------------------------
# LangChain runnables (assistant.llm.model and friends) are
# auto-instrumented by LangSmith's callback handler the
# moment LANGCHAIN_TRACING_V2=true and LANGCHAIN_API_KEY are present in
# the environment -- no code changes needed for those. This block just:
#   1. sets a sane default project name (so traces aren't dumped into
#      LangSmith's "default" project) without clobbering one you already
#      set in .env, and
#   2. logs plainly at startup whether tracing is actually on, so a
#      missing/typo'd key fails loud instead of silently not tracing.
# LLM.py's raw `requests` calls to OpenAI Vision (extract_po_data_from_
# document, extract_document_text, ask_about_document) do NOT go through
# LangChain, so they are NOT auto-traced -- see the @traceable decorators
# added on those functions instead, which report to the same project.
#
# Add to your .env to enable:
#   LANGCHAIN_TRACING_V2=true
#   LANGCHAIN_API_KEY=ls__...
#   LANGCHAIN_PROJECT=magma-assistance      # optional, defaults below
#   LANGCHAIN_ENDPOINT=https://api.smith.langchain.com   # optional
os.environ.setdefault("LANGCHAIN_PROJECT", "magma-assistance")
LANGSMITH_TRACING_ENABLED = (
    os.environ.get("LANGCHAIN_TRACING_V2", "").lower() == "true"
    and bool(os.environ.get("LANGCHAIN_API_KEY"))
)
if LANGSMITH_TRACING_ENABLED:
    logger.info(
        "LangSmith tracing ENABLED -- project='%s', endpoint='%s'",
        os.environ.get("LANGCHAIN_PROJECT"),
        os.environ.get("LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com"),
    )
else:
    logger.info(
        "LangSmith tracing disabled (set LANGCHAIN_TRACING_V2=true and "
        "LANGCHAIN_API_KEY in .env to enable)."
    )

# `WHISPER_MODEL` now names an OpenAI hosted transcription model (STT),
# not a local Whisper checkpoint -- e.g. "gpt-4o-mini-transcribe" or
# "whisper-1". `TTS_VOICE` must be one of OpenAI's TTS voices (alloy,
# ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse).
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "gpt-4o-mini-transcribe")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")
TTS_VOICE = os.environ.get("TTS_VOICE", "alloy")
# Neither OpenAI nor (especially) OpenRouter can be trusted to pick a
# sensible default completion length on their own -- OpenRouter in
# particular will silently cap some routed providers far below the
# model's real context window when `max_tokens` is omitted. Without an
# explicit value here, long replies get cut off mid-sentence with
# finish_reason="length" and no error, and the old code below wasn't
# checking finish_reason at all, so the truncated text just went out
# as if it were complete. Set high on purpose; MAX_COMPLETION_ROUNDS
# below is what actually stops a truncated reply from continuing
# forever.
LLM_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", "4096"))
# Safety cap on how many times we'll ask the model to continue a reply
# that got cut off by the token limit above, so a pathological
# never-ending completion can't loop forever.
MAX_COMPLETION_ROUNDS = int(os.environ.get("LLM_MAX_COMPLETION_ROUNDS", "4"))
# Neither the sync (requests) nor the async (httpx) call to the LLM API
# had a timeout at all -- the streaming path was explicitly
# timeout=None. If the provider stalls mid-connection (dropped
# packets, an OpenRouter route hanging, etc.) the request just sits
# open forever: no exception, no response, nothing -- which is exactly
# what produces an endless "Thinking..." spinner on the frontend with
# zero output and no visible error. This caps how long we'll wait.
LLM_REQUEST_TIMEOUT_SECONDS = float(os.environ.get("LLM_REQUEST_TIMEOUT_SECONDS", "90"))

logger.info("Loading VoiceAssistant agent (STT=%s, LLM=%s)...", WHISPER_MODEL, LLM_MODEL)
assistant = VoiceAssistant(
    whisper_model=WHISPER_MODEL,
    llm_model=LLM_MODEL,
    tts_voice=TTS_VOICE,
    speak_replies=False,
)


TOOL_RAG_TOP_K = int(os.environ.get("TOOL_RAG_TOP_K", "3"))
TOOL_RAG_MIN_SCORE = float(os.environ.get("TOOL_RAG_MIN_SCORE", "0.25"))
# At or below this many total registered tools, agent_node binds every
# tool directly instead of running ToolRAG's similarity-threshold
# retrieval — see the comment in agent_node for why. With only a
# handful of local tools (ERP_Unified's 2 + the web tools' 4 = 6),
# direct binding is far more reliable than similarity search: ToolRAG's
# top-k retrieval was built for scaling to dozens/hundreds of MCP tools,
# and on a small fixed set it can drop an obviously-needed tool (e.g.
# erp_data_tool) just because recent conversation text skewed the
# embedding toward something else. Keep this comfortably above
# len(ALL_TOOLS) unless you register many more tools later.
TOOL_RAG_BYPASS_THRESHOLD = int(os.environ.get("TOOL_RAG_BYPASS_THRESHOLD", "100"))

# ERP_Unified's erp_data_tool/erp_describe_fields are plain LangChain
# @tool functions (ERP_Unified/tools.py calls erp_client directly, no
# subprocess/MCP transport involved) so they're indexed synchronously
# right here at import time — no async lifespan step needed to load an
# ERP tool source anymore.
logger.info("Using ERP_Unified as the sole ERP tool source (erp_data_tool / erp_describe_fields).")

tool_rag = None
tool_map = {}
if ALL_TOOLS:
    tool_map = {tool.name: tool for tool in ALL_TOOLS}
    if len(ALL_TOOLS) > TOOL_RAG_BYPASS_THRESHOLD:
        logger.info("Indexing %d local agent tool(s) for retrieval...", len(ALL_TOOLS))
        tool_rag = ToolRAG(ALL_TOOLS, top_k=TOOL_RAG_TOP_K, min_score=TOOL_RAG_MIN_SCORE)
    else:
        logger.info("Skipping HuggingFace ToolRAG indexing (only %d tools).", len(ALL_TOOLS))
else:
    logger.info("No ERP tools registered.")


from fastapi import BackgroundTasks

# Python 3.11+ asyncio can garbage collect background tasks if no strong reference is kept.
# We store them here to prevent them from being killed mid-execution (e.g. while saving to SQLite).
_bg_tasks = set()
_checkpoint_conn = None  # global aiosqlite connection, used to force commits after saves

def safe_create_task(coro):
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return task

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs once at server startup and once at shutdown (FastAPI lifespan
    protocol). ERP tools are now loaded synchronously above at import
    time, and the SQLite audit log initializes itself on import
    (db/postgres_audit_log.py), so there's nothing left to set up here
    before the checkpointer below."""

    import aiosqlite
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    global saver, _checkpoint_conn
    _checkpoint_conn = await aiosqlite.connect("stream_history.sqlite", isolation_level=None)
    try:
        saver = AsyncSqliteSaver(_checkpoint_conn)
        await saver.setup()
        logger.info("AsyncSqliteSaver persistent memory ready.")
        yield
    finally:
        await _checkpoint_conn.close()
        _checkpoint_conn = None


app = FastAPI(title="MagmaAssistance Backend", lifespan=lifespan)

# Allow CORS requests from frontend.
# Default stays permissive ("*", no credentials) so existing deployments
# keep working untouched -- this must never default to blocking prod just
# because ALLOWED_ORIGINS wasn't set on that particular deploy. Set
# ALLOWED_ORIGINS (comma-separated) to lock this down and enable
# credentialed requests, e.g. for local dev:
#   ALLOWED_ORIGINS=http://localhost:8000,http://magna.local:8000
# allow_origin_regex covers local/dev hosts and devtunnels without having
# to enumerate every port -- it only applies once ALLOWED_ORIGINS is set,
# since allow_origin_regex plus allow_origins=["*"] is rejected by Starlette.
_cors_origins_env = os.environ.get("ALLOWED_ORIGINS")
if _cors_origins_env:
    ALLOWED_ORIGINS = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
    ALLOW_CREDENTIALS = "*" not in ALLOWED_ORIGINS
    ALLOW_ORIGIN_REGEX = (
        r"https?://(localhost|127\.0\.0\.1|.*\.local)(:\d+)?|https://.*\.devtunnels\.ms"
    )
else:
    ALLOWED_ORIGINS = ["*"]
    ALLOW_CREDENTIALS = False
    ALLOW_ORIGIN_REGEX = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOW_ORIGIN_REGEX,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# Memory: per-session message history, trimmed to a token budget
# ---------------------------------------------------------------------
#
# stream_agent_turn keeps a caller-owned `history` list per session (see
# load_stream_history/save_stream_history below, backed by
# stream_history.sqlite) and sends a trimmed window of it to the LLM each
# turn via trim_messages(..., max_tokens=MAX_HISTORY_TOKENS), so
# latency/cost stay flat as a session grows.
MAX_HISTORY_TOKENS = 60000  # Approximated: 1 token ~= 4 chars

def _approx_tokens(messages: list) -> int:
    return sum(len(str(m.content)) // 4 for m in messages)



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

# =====================================================================
# STEP 1 & 2: PURCHASE ORDER DOCUMENT UPLOAD ENDPOINT (WITH OCR)
# =====================================================================

# Initialize LLM instance for OCR processing
llm_ocr_engine = LLM()

class DocumentUploadResponse(BaseModel):
    status: str
    filename: str
    message: str
    ocr_data: Optional[Dict[str, Any]] = None

@app.post("/api/upload-po", response_model=DocumentUploadResponse)
async def upload_purchase_order_file(
    file: UploadFile = File(...),
    session_id: str = Form("default"),
    user_id: str = Form("anonymous"),
):
    """
    Handles PO Image / PDF file upload, runs Vision OCR extraction, and --
    if the document actually looks like a Purchase Order -- creates it
    directly in ERPNext right here via the OCR-aware auto-create tool
    (process_ocr_po_and_create_order in ERP/tools/ocr_po_tool.py, which
    matches-or-auto-creates the Supplier and Items).

    This is deliberate: it does NOT hand the extracted data off to the
    chat agent to decide which tool to call. That path is ambiguous --
    the agent's tool-RAG retrieval can surface the generic
    create_purchase_order tool (ERP/tools/purchase_write_tools.py)
    instead, which requires an *already-existing* Supplier ID and Item
    codes and fails outright ("supplier/item not found") rather than
    auto-creating them like the OCR tool does. Calling the right tool
    directly here removes that ambiguity entirely.

    If the document doesn't look like a PO, nothing is created -- its
    extracted text is stashed in document_store instead (same as
    /api/upload-document), so the user can ask questions about it in
    chat afterward.
    """
    allowed_types = ["image/jpeg", "image/png", "application/pdf", "image/jpg"]
    
    # 1. Check file type
    if file.content_type.lower() not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{file.content_type}'. Please upload JPEG, PNG, or PDF."
        )

    try:
        # 2. Read file bytes
        file_bytes = await file.read()
        
        # 3. Check file size (Max 10MB)
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=400, 
                detail="File size exceeds the 10MB limit."
            )

        logger.info(f"File '{file.filename}' uploaded successfully for session '{session_id}'. Extracting OCR data...")

        # 3.5. Store the original file in S3 and record who uploaded it
        # and when -- independent of whether OCR later decides it's a PO
        # or not, so the original document is never lost. Skipped when
        # S3 isn't configured (e.g. running locally with no AWS creds)
        # instead of raising -- OCR extraction and PO creation still run,
        # they just don't have an S3-backed copy of the source file.
        upload_meta = None
        if s3_storage.is_configured():
            upload_meta = s3_storage.upload_file(
                file_bytes=file_bytes,
                original_filename=file.filename,
                content_type=file.content_type,
                upload_kind="purchase_order",
                session_id=session_id,
                user_id=user_id,
            )
        else:
            logger.info("S3 not configured -- skipping original-file storage for '%s'.", file.filename)

        # 4. Trigger Vision OCR Extraction from LLM.py. ocr_result["is_po"]
        # tells us which branch this document fell into.
        ocr_result = llm_ocr_engine.extract_po_data_from_document(
            file_bytes=file_bytes, 
            mime_type=file.content_type
        )

        if not ocr_result.get("is_po"):
            # Not a recognizable PO -- store its text for chat Q&A
            # instead of attempting (and failing) to create anything.
            document_store[session_id] = {
                "filename": file.filename,
                "text": ocr_result.get("raw_text", ""),
                "injected": False,
            }
            if upload_meta:
                audit_log.record_file_upload(
                    **upload_meta, extracted_metadata=ocr_result, status="processed",
                )
            return DocumentUploadResponse(
                status="not_a_po",
                filename=file.filename,
                message=ocr_result.get(
                    "note", "This document doesn't look like a Purchase Order."
                ) + " You can ask questions about it in chat.",
                ocr_data=ocr_result
            )

        # 5. It IS a PO -- create it directly via the OCR-aware auto-create
        # tool (matches/auto-creates Supplier + Items), bypassing the chat
        # agent's tool selection for this flow.
        create_args = {
            "vendor_name": ocr_result.get("vendor_name", ""),
            "items": ocr_result.get("items", []),
            "po_number": ocr_result.get("po_number", ""),
            "delivery_date": ocr_result.get("delivery_date", ""),
            "remarks": ocr_result.get("payment_terms", ""),
        }
        creation_result = await _execute_tool(
            "process_ocr_po_and_create_order", create_args, session_id=session_id,
            user_id=user_id, prompt_text=f"[uploaded PO file '{file.filename}']",
        )
        logger.info("PO auto-create result: %s", creation_result)

        if upload_meta:
            audit_log.record_file_upload(
                **upload_meta, extracted_metadata=ocr_result, status="processed",
            )

        return DocumentUploadResponse(
            status="success",
            filename=file.filename,
            message=str(creation_result),
            ocr_data=ocr_result
        )

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.exception("Error handling document upload in /api/upload-po")
        raise HTTPException(status_code=500, detail=f"Failed to process uploaded file: {str(e)}")



# =====================================================================
# GENERAL-PURPOSE DOCUMENT UPLOAD (ANY PDF/IMAGE, NOT JUST POs)
# =====================================================================
# Separate from /api/upload-po above -- that endpoint's strict Purchase
# Order JSON extraction / auto-create-in-ERPNext flow is untouched.
# This lets a user upload any PDF/image; the extracted text is stashed
# here per session_id. NOTE: the code that used to inject this into the
# conversation lived in generate_reply(), which has been removed along
# with /api/chat and /query -- nothing currently re-surfaces this text
# into the live /api/chat/stream or /ws/voice paths. Needs re-wiring if
# "ask questions about an uploaded document" is still a required flow.
document_store: Dict[str, Dict[str, Any]] = {}  # session_id -> {filename, text, injected}

# session_id -> ERPIdentity: the real ERPNext user each chat session is
# acting as, resolved via /api/session/identify. NOTE: binding this
# around the agent turn (so every erp_data_tool call runs with THAT
# PERSON'S OWN ERPNext credentials, gated by Frappe's own permission
# engine) used to happen in generate_reply(), which has been removed.
# It is not currently wired into /api/chat/stream or /ws/voice -- see
# ARCHITECTURE.md P3 (identity wiring). Sessions with nothing here just
# keep using the shared service account, same as before this was wired up.
session_identities: Dict[str, ERPIdentity] = {}

class SessionIdentifyRequest(BaseModel):
    session_id: str
    erp_api_key: Optional[str] = None
    erp_api_secret: Optional[str] = None
    sid: Optional[str] = None
    user_id: Optional[str] = None
    csrf_token: Optional[str] = None


@app.post("/api/session/identify")
async def identify_session(req: SessionIdentifyRequest):
    """Bind a real ERPNext user to a chat session, via their personal
    API key/secret or active Frappe session cookie (sid)."""
    try:
        if req.erp_api_key and req.erp_api_secret:
            identity = erp_client.resolve_identity(req.erp_api_key, req.erp_api_secret)
        elif req.sid:
            identity = erp_client.resolve_session_identity(
                req.sid, user_id=req.user_id, csrf_token=req.csrf_token
            )
        else:
            raise HTTPException(status_code=400, detail="Either erp_api_key/secret or sid must be provided.")
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
    session_identities[req.session_id] = identity
    return {"authenticated": True, "user": identity.user, "roles": identity.roles}


@app.post("/api/session/logout")
async def logout_session(session_id: str = Form(...)):
    """Unbind whatever identity was set for this session -- subsequent
    turns fall back to the shared service account until re-identified."""
    session_identities.pop(session_id, None)
    return {"success": True}


class GeneralDocumentUploadResponse(BaseModel):
    status: str
    filename: str
    message: str
    page_count: int
    extraction_method: str


@app.post("/api/upload-document", response_model=GeneralDocumentUploadResponse)
async def upload_general_document(
    file: UploadFile = File(...),
    session_id: str = Form("default"),
    user_id: str = Form("anonymous"),
    sid: Optional[str] = Form(None),
    csrf_token: Optional[str] = Form(None),
):
    """Reads ANY PDF or image (not just Purchase Orders), extracts its
    full text, and stores it against session_id so the user can ask
    follow-up questions about it in normal chat. Same S3-optional
    behavior as /api/upload-po -- storing the original file is skipped
    when S3 isn't configured, so this works for local testing with no
    AWS credentials set."""
    if sid and session_id not in session_identities:
        try:
            session_identities[session_id] = erp_client.resolve_session_identity(
                sid, user_id=user_id, csrf_token=csrf_token
            )
        except Exception as exc:
            logger.warning("Could not resolve session identity on upload for %s: %s", session_id, exc)

    allowed_types = ["image/jpeg", "image/png", "application/pdf", "image/jpg"]

    if file.content_type.lower() not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{file.content_type}'. Please upload JPEG, PNG, or PDF."
        )

    try:
        file_bytes = await file.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds the 10MB limit.")

        logger.info(f"File '{file.filename}' uploaded for session '{session_id}'. Extracting document text...")

        upload_meta = None
        if s3_storage.is_configured():
            upload_meta = s3_storage.upload_file(
                file_bytes=file_bytes,
                original_filename=file.filename,
                content_type=file.content_type,
                upload_kind="general_document",
                session_id=session_id,
                user_id=user_id,
            )
        else:
            logger.info("S3 not configured -- skipping original-file storage for '%s'.", file.filename)

        extraction = llm_ocr_engine.extract_document_text(file_bytes=file_bytes, mime_type=file.content_type)

        document_store[session_id] = {
            "filename": file.filename,
            "text": extraction["text"],
            "injected": False,
        }

        if upload_meta:
            audit_log.record_file_upload(
                **upload_meta,
                extracted_metadata={
                    "page_count": extraction["page_count"],
                    "pages_read": extraction["pages_read"],
                    "method": extraction["method"],
                },
                status="processed",
            )

        return GeneralDocumentUploadResponse(
            status="success",
            filename=file.filename,
            message=(
                f"Document read successfully ({extraction['pages_read']}/{extraction['page_count']} "
                f"page(s), method={extraction['method']}). You can now ask questions about it in chat."
            ),
            page_count=extraction["page_count"],
            extraction_method=extraction["method"],
        )

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.exception("Error handling document upload in /api/upload-document")
        raise HTTPException(status_code=500, detail=f"Failed to process uploaded file: {str(e)}")


# ---------------------------------------------------------------------
# Code-enforced write-approval gate (ARCHITECTURE.md P1)
# ---------------------------------------------------------------------
#
# _execute_tool is the one choke point every tool call passes through
# (see its docstring below), so it's also the right place to enforce
# "no write reaches ERPNext without an explicit human 'yes'" in CODE
# rather than as a prompt instruction the model might skip, misfire, or
# reconstruct incorrectly. This replaces the ad-hoc, web_enriched-only,
# model-trusted `approved=True` re-call pattern in
# ERP_Unified/tools._run_create (still there, still harmless, but no
# longer the only gate; see the note above `_is_write_call`).
#
# Mechanism, in two turns:
#   Turn N   — the model calls a write tool. _execute_tool intercepts it,
#              STASHES the exact (tool_name, args) it was about to run
#              keyed by session_id, and returns a proposal string instead
#              of touching ERPNext. The model relays that proposal to the
#              user as the tool result; nothing has been written yet.
#   Turn N+1 — stream_agent_turn() checks, before calling the LLM at all,
#              whether this session has a pending proposal AND the new
#              user message is an unambiguous "yes". If so it calls
#              _execute_tool(bypass_gate=True) with the EXACT stashed
#              args from turn N — not whatever the model might produce
#              this turn — so approval always executes the reviewed
#              payload, byte for byte. A clear "no" cancels it, also
#              without any model involvement. Anything else (a
#              correction, a new question) drops the stale proposal and
#              falls through to normal handling, so an old approval can
#              never be replayed against a payload the user never saw.
#
# One pending proposal per session_id: a second write call before the
# first is resolved simply replaces it (the newer proposal is the one
# still on the table).
_PENDING_APPROVALS: dict[str, dict] = {}

# Which tools are gated, and — for erp_data_tool specifically — which of
# its `operation` values count as a write. list/get never touch this
# gate; only create/update/submit do. erp_send_email is always gated
# since every call sends real email.
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
    """Human-readable one/two-liner for the proposal message. Kept
    separate from the raw stashed args so the exact payload that will
    be executed on approval is never reconstructed from this text."""
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


# An affirmative opener. The message must START with one of these.
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
# Words that turn an apparent "yes" into a correction / conditional, so
# it must NOT count as consent even though it opens with an affirmative.
_CORRECTION_RE = re.compile(
    r"\b(but|however|wait|hold on|actually|instead|except|change|"
    r"different|rather|update|remove|use|make it|first|before|"
    r"only if|unless|not )\b|\?",
    re.IGNORECASE,
)


def _is_write_approval(message: str) -> bool:
    """True only for an unambiguous go-ahead. Accepts natural phrasings
    ("yes", "yes create it", "sure go ahead", "ok do it") but rejects
    anything carrying a correction or condition ("yes but change the
    amount", "yes, use a different email") — those fall through to normal
    handling so the stale proposal is dropped, never replayed against a
    payload the user did not fully approve."""
    text = (message or "").strip()
    if not text or len(text.split()) > 10:
        return False
    if _CORRECTION_RE.search(text):
        return False
    return bool(_YES_RE.match(text))


def _is_write_rejection(message: str) -> bool:
    return bool(_NO_RE.match((message or "").strip()))


async def _execute_tool(
    tool_name: str,
    args: dict,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    prompt_text: Optional[str] = None,
    bypass_gate: bool = False,
):
    """Async because MCP-sourced tools (ERP/mcp_server.py, loaded via
    ERP/tools/mcp_tools.py) only implement `.ainvoke()`, not the sync
    `.invoke()`. This works transparently for the existing local
    ERP/tools/*.py tools too — LangChain's BaseTool.ainvoke() runs a sync
    tool's normal invoke() under the hood when no native async
    implementation exists, so no other tool code needed to change.

    Every call is written to the Postgres audit log (session_id, tool,
    args, result, how long it took, and who prompted it) regardless of
    success — this is the one choke point all tool execution passes
    through, so it's the cheapest place to record "what actions did the
    agent actually take" for later review.

    `bypass_gate=True` is used ONLY by stream_agent_turn's deterministic
    "yes" handler, to actually run a previously-approved, stashed
    payload. Every other caller goes through the normal path below,
    where a write call is intercepted and stashed instead of executed.
    """
    if not bypass_gate and session_id and _is_write_call(tool_name, args):
        effective_args = _sanitize_tool_args(tool_name, args) or {}
        if tool_name == "erp_data_tool":
            effective_args = {**effective_args, "session_id": session_id}
        _PENDING_APPROVALS[session_id] = {"tool_name": tool_name, "args": effective_args}
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

    tool = tool_map.get(tool_name)
    if tool is None:
        result = f"Tool '{tool_name}' is not available."
        if session_id:
            audit_log.log_turn(
                session_id, "tool", result, tool_name=tool_name, tool_args=args,
                user_id=user_id, prompt_text=prompt_text, tool_status="not_found",
            )
        return result
    try:
        effective_args = _sanitize_tool_args(tool_name, args) or {}
        # The generic ERP tool keeps multi-turn create state by session.
        # Bind tool calls to the real chat session rather than letting the
        # model omit it and fall back to the shared "default" bucket.
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
            _PENDING_APPROVALS.pop(session_id, None)
        return result
    except PermissionError as e:
        # Raised by erp_client when a bound per-user ERPIdentity (see
        # /api/session/identify) is denied by Frappe's own permission
        # engine -- surfaced as-is so the agent can tell the person why,
        # instead of a generic failure message.
        logger.warning("Tool '%s' denied by ERPNext permission check: %s", tool_name, e)
        failure = str(e)
        if session_id:
            audit_log.log_turn(
                session_id, "tool", failure, tool_name=tool_name, tool_args=args,
                user_id=user_id, prompt_text=prompt_text, tool_status="permission_denied",
                error_message=str(e),
            )
            if bypass_gate:
                _PENDING_APPROVALS.pop(session_id, None)
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
                _PENDING_APPROVALS.pop(session_id, None)
        return failure


async def _stream_chat_completion(messages, tools=None):
    api_messages = [convert_message_to_dict(m) for m in messages]
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    env_openai_key = os.environ.get("OPENAI_API_KEY")
    key = openrouter_key or env_openai_key
    is_openrouter = bool(openrouter_key)
    if is_openrouter:
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "HTTP-Referer": "http://localhost:8050", "X-Title": "MagmaAssistance"}
        url = "https://openrouter.ai/api/v1/chat/completions"
        model_name = LLM_MODEL if "/" in LLM_MODEL else f"openai/{LLM_MODEL}"
    else:
        headers = {"Authorization": f"Bearer {env_openai_key}", "Content-Type": "application/json"}
        url = "https://api.openai.com/v1/chat/completions"
        model_name = LLM_MODEL
    data = {"model": model_name, "messages": api_messages, "temperature": assistant.llm.temperature, "stream": True, "max_tokens": LLM_MAX_TOKENS}
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
    """Wraps _stream_chat_completion with the same finish_reason=="length"
    continuation handling as OpenAIChatModel._generate, so streamed
    replies don't silently cut off mid-sentence either. Yields token
    events as they arrive, then a final {"type": "done", "content":
    ..., "tool_calls": ...} once the reply is actually complete (or
    MAX_COMPLETION_ROUNDS is hit). Tool-call replies are never
    continued -- same reasoning as the non-streaming path."""
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


async def stream_agent_turn(text, session_id=None, user_id=None, history=None, task_context=None):
    """The live agent loop for both /api/chat/stream (text) and /ws/voice
    (voice). Keeps its own `history` list (caller-owned, per-connection),
    backed by the bare AsyncSqliteSaver on stream_history.sqlite (see
    load_stream_history/save_stream_history below) rather than a
    LangGraph-compiled graph. Yields token/tool_call/tool_result/done
    event dicts in call order.

    IMPORTANT: We track start_len so callers can extract only the NEW messages
    added this turn (the delta) for saving, since load/save_stream_history
    append rather than overwrite.
    """
    history = history if history is not None else []
    start_len = len(history)  # snapshot before we mutate

    # --- code-enforced write-approval gate: resolve a pending proposal
    # from the PREVIOUS turn before the LLM ever sees this message. See
    # the block above _execute_tool for the full mechanism. ---
    pending = _PENDING_APPROVALS.get(session_id) if session_id else None
    if pending and _is_write_approval(text):
        history.append(HumanMessage(content=text))
        yield {"type": "tool_call", "name": pending["tool_name"], "args": pending["args"]}
        result = await _execute_tool(
            pending["tool_name"], pending["args"],
            session_id=session_id, user_id=user_id, prompt_text=text,
            bypass_gate=True,
        )
        yield {"type": "tool_result", "name": pending["tool_name"], "result": result}
        # Let the model phrase the confirmation naturally from the real
        # result, but the write itself already happened above, exactly
        # against the stashed payload -- this call cannot cause a second
        # write, it only produces prose.
        summary_messages = [
            SystemMessage(content=assistant.llm.system_prompt),
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
        _PENDING_APPROVALS.pop(session_id, None)
        history.append(HumanMessage(content=text))
        cancel_text = "Okay, I've cancelled that — nothing was changed."
        history.append(AIMessage(content=cancel_text))
        audit_log.log_turn(session_id, "tool", cancel_text, tool_name=pending["tool_name"],
                            tool_args=pending["args"], user_id=user_id, prompt_text=text,
                            tool_status="rejected")
        yield {"type": "done", "text": cancel_text, "_delta": history[start_len:]}
        return

    if pending:
        # Neither a clean "yes" nor a clean "no" -- e.g. a correction
        # ("change the amount to 500") or an unrelated new message. The
        # stale proposal must not be executable by a later stray "yes",
        # so drop it and fall through to normal handling; if the user
        # still wants the action, the model will call the tool again
        # (with corrected args, if any) and a fresh proposal is stashed.
        _PENDING_APPROVALS.pop(session_id, None)

    history.append(HumanMessage(content=text))
    # Trim for LLM context window — this is a separate list, does NOT affect history
    trimmed = trim_messages(history, max_tokens=MAX_HISTORY_TOKENS, token_counter=_approx_tokens, strategy="last", include_system=False)

    candidate_tools = []
    if ALL_TOOLS:
        candidate_tools = list(ALL_TOOLS) if len(ALL_TOOLS) <= TOOL_RAG_BYPASS_THRESHOLD else (tool_rag.retrieve(text) if tool_rag else [])

    openai_tools = None
    if candidate_tools:
        from langchain_core.utils.function_calling import convert_to_openai_tool
        openai_tools = []
        for t in candidate_tools:
            formatted = convert_to_openai_tool(t)
            if "function" in formatted and "parameters" in formatted["function"]:
                formatted["function"]["parameters"] = _clean_schema_for_openai(formatted["function"]["parameters"])
            openai_tools.append(formatted)

    system_parts = [assistant.llm.system_prompt]
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
                # Yield the delta (only newly added messages) so callers can save it
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
        # Clean up ONLY if we have a dangling AIMessage with tool_calls that lacks matching ToolMessages
        if history:
            last_msg = history[-1]
            if isinstance(last_msg, AIMessage) and getattr(last_msg, "tool_calls", None):
                history.pop()
            elif isinstance(last_msg, ToolMessage):
                # Count how many ToolMessages we have at the end
                tool_msg_count = 0
                for msg in reversed(history):
                    if isinstance(msg, ToolMessage):
                        tool_msg_count += 1
                    else:
                        break
                
                # Check the AIMessage that preceded these ToolMessages
                if len(history) > tool_msg_count:
                    ai_msg = history[-(tool_msg_count + 1)]
                    if isinstance(ai_msg, AIMessage) and getattr(ai_msg, "tool_calls", None):
                        if len(ai_msg.tool_calls) != tool_msg_count:
                            # Incomplete tool execution sequence! Pop them all to prevent OpenAI 400 errors.
                            for _ in range(tool_msg_count + 1):
                                history.pop()
        raise


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

class TTSRequest(BaseModel):
    text: str

@app.post("/api/tts")
async def synthesize_speech(req: TTSRequest):
    """Synthesizes arbitrary text to speech with `assistant.tts` -- the
    same OpenAI TTS voice/model instance Live Voice Mode speaks with (see
    `register_voice_ws(app, stream_agent_turn, assistant.tts, logger)`
    below). The chat UI's per-message "read aloud" button and the
    "auto-read replies" toggle both call this, so typed-chat playback
    sounds identical to the realtime voice assistant rather than falling
    back to the browser's own (different-sounding) speech synthesis."""

    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    try:
        wav_bytes = _get_tts_audio(text)
    except Exception as exc:  # noqa: BLE001
        logger.exception("TTS synthesis failed for /api/tts")
        raise HTTPException(status_code=500, detail=str(exc))

    if not wav_bytes:
        raise HTTPException(status_code=500, detail="TTS synthesis returned no audio")

    return {"audio": base64.b64encode(wav_bytes).decode("ascii")}


@app.post("/api/tts/stream")
async def synthesize_speech_stream(req: TTSRequest):
    """Streams TTS audio chunks directly from OpenAI as they are generated.
    Starts sending audio within ~200ms instead of waiting for the full file.
    The browser plays chunks progressively via MediaSource API.
    Returns: chunked audio/mpeg stream."""
    from fastapi.responses import StreamingResponse
    import asyncio

    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    def generate_chunks():
        try:
            for chunk in assistant.tts.synthesize_stream(text, response_format="mp3"):
                yield chunk
        except Exception as exc:
            logger.exception("Streaming TTS failed")

    return StreamingResponse(generate_chunks(), media_type="audio/mpeg")

class ChatRequest(BaseModel):
    message: str

    session_id: str = "default"
    user_id: Optional[str] = None  # who's asking -- pass from auth/frontend once available
    sid: Optional[str] = None      # Frappe session cookie (sid) for per-user RBAC
    csrf_token: Optional[str] = None  # Frappe CSRF token for per-user session writes

import copy
from datetime import datetime, timezone
from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.base.id import uuid6

async def load_stream_history(session_id: str) -> list:
    global saver
    config = {"configurable": {"thread_id": session_id, "checkpoint_ns": ""}}
    tup = await saver.aget_tuple(config)
    if tup and tup.checkpoint:
        return list(tup.checkpoint["channel_values"].get("messages", []))
    return []

async def save_stream_history(session_id: str, new_messages: list):
    if not new_messages:
        return
    global saver, _checkpoint_conn
    config = {"configurable": {"thread_id": session_id, "checkpoint_ns": ""}}

    prev = await saver.aget_tuple(config)
    if prev and prev.checkpoint:
        checkpoint = copy.deepcopy(prev.checkpoint)
        existing = list(checkpoint["channel_values"].get("messages", []))
        checkpoint["channel_values"]["messages"] = existing + new_messages
        version = checkpoint["channel_versions"].get("messages", 0) + 1
    else:
        checkpoint = empty_checkpoint()
        checkpoint["channel_values"]["messages"] = list(new_messages)
        version = 1

    checkpoint["id"] = str(uuid6(clock_seq=-2))
    checkpoint["ts"] = datetime.now(timezone.utc).isoformat()
    checkpoint["channel_versions"]["messages"] = version

    metadata = {"source": "update", "step": -1, "writes": {}, "parents": {}}
    await saver.aput(config, checkpoint, metadata, {"messages": version})

    if _checkpoint_conn:
        try:
            await _checkpoint_conn.commit()
        except Exception:
            pass


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """SSE variant of /api/chat for token-by-token terminal streaming with
    inline tool-call/tool_result markers, same event shape /ws/voice uses.
    Keeps its own per-session_id history (backed by stream_history.sqlite) 
    so this is purely additive."""
    from fastapi.responses import StreamingResponse

    text = (req.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="message is required")

    # Resolve per-user ERP identity (if sid or API credentials provided)
    identity = session_identities.get(req.session_id)
    if not identity and req.sid:
        try:
            identity = erp_client.resolve_session_identity(
                req.sid, user_id=req.user_id, csrf_token=req.csrf_token
            )
            session_identities[req.session_id] = identity
        except Exception as exc:
            logger.warning("Could not resolve session identity for %s: %s", req.session_id, exc)
    elif identity and req.csrf_token and not getattr(identity, "csrf_token", None):
        identity.csrf_token = req.csrf_token

    history = await load_stream_history(req.session_id)
    start_len = len(history)  # snapshot before the turn mutates history

    async def event_gen():
        # Flush the SSE response and its CORS headers through Dev Tunnels
        # before the agent/tool pipeline starts. Visualisation tools can take
        # long enough that the tunnel otherwise produces its own timeout
        # response, which the browser misleadingly reports as a CORS failure.
        yield ": connected\n\n"
        effective_user_id = identity.user if identity else req.user_id
        try:
            with use_identity(identity):
                async for event in stream_agent_turn(text, session_id=req.session_id, user_id=effective_user_id, history=history):
                    # Strip internal _delta key before sending to browser
                    browser_event = {k: v for k, v in event.items() if k != "_delta"}
                    yield f"data: {json.dumps(browser_event)}\n\n"
        except Exception as exc:  # noqa: BLE001
            logger.exception("Streaming agent turn failed: %s", text)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            # Save ONLY the new messages from this turn (delta), not the full history
            delta = history[start_len:]
            if delta:
                try:
                    await save_stream_history(req.session_id, delta)
                except Exception as save_err:
                    logger.warning("Could not save stream history for %s: %s", req.session_id, save_err)
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

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


from Voice.ws_voice import register_voice_ws
register_voice_ws(app, stream_agent_turn, assistant.tts, logger, load_stream_history, save_stream_history)

# Shared with Voice/ws_voice.py so it can look up an identity bound via
# /api/session/identify without a circular import.
app.state.session_identities = session_identities


@app.get("/api/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8050))
    logger.info(f"Starting server on port {port}...")

    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)