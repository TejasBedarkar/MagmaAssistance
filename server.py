import base64
import os
import re
import shutil
import logging
import json
import sys
import ast
from datetime import datetime
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
import db.postgres_audit_log as audit_log
from db.init_db import apply_schema
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
        }
        
        if self.bound_tools:
            data["tools"] = self.bound_tools
            
        response = requests.post(target_url, json=data, headers=headers)
        
        if not response.ok:
            logger.error(f"LLM API Rejected Request ({response.status_code}): {response.text}")

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
# etc.) are no longer registered, so ALL_REQUIRED_FIELDS/ALL_FIELD_PARSERS
# (which only had entries keyed by those old tool names) aren't needed
# either; erp_data_tool does its own missing-field prompting internally
# via ERP.dynamic_fields, keyed by session_id instead of by tool name.
from ERP_Unified.tools import ERP_UNIFIED_TOOLS
from ERP.tools.DashboardUI_tools import DASHBOARD_UI_TOOLS
from web.web_tool import WEB_TOOLS

ALL_TOOLS = [*ERP_UNIFIED_TOOLS, *DASHBOARD_UI_TOOLS, *WEB_TOOLS]
ALL_REQUIRED_FIELDS: dict = {}
ALL_FIELD_PARSERS: dict = {}


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent-server")

# ---------------------------------------------------------------------
# LangSmith tracing (optional -- no-op if LANGCHAIN_API_KEY isn't set)
# ---------------------------------------------------------------------
# LangChain/LangGraph runnables (assistant.llm.model, text_chain,
# agent_graph) are auto-instrumented by LangSmith's callback handler the
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
TOOL_RAG_BYPASS_THRESHOLD = int(os.environ.get("TOOL_RAG_BYPASS_THRESHOLD", "10"))

# ERP_Unified's erp_data_tool/erp_describe_fields are plain LangChain
# @tool functions (ERP_Unified/tools.py calls erp_client directly, no
# subprocess/MCP transport involved) so they're indexed synchronously
# right here at import time — no async lifespan step needed to load an
# ERP tool source anymore.
logger.info("Using ERP_Unified as the sole ERP tool source (erp_data_tool / erp_describe_fields).")

tool_rag = None
tool_map = {}
if ALL_TOOLS:
    logger.info("Indexing %d local agent tool(s) for retrieval...", len(ALL_TOOLS))
    tool_rag = ToolRAG(ALL_TOOLS, top_k=TOOL_RAG_TOP_K, min_score=TOOL_RAG_MIN_SCORE)
    tool_map = {tool.name: tool for tool in ALL_TOOLS}
else:
    logger.info("No ERP tools registered.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs once at server startup and once at shutdown (FastAPI lifespan
    protocol). ERP tools are now loaded synchronously above at import
    time, so this only handles the Postgres audit-log schema."""

    # Creates sessions / audit_log / file_uploads in Postgres if they
    # don't exist yet (schema.sql is idempotent, so this is safe to run
    # on every startup, not just the first). Doesn't crash the server if
    # Postgres is misconfigured/unreachable -- it logs instead, so the
    # rest of the app still comes up; audit logging just won't work
    # until PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE are fixed in .env.
    try:
        apply_schema()
        logger.info("Postgres audit-log schema ready.")
    except Exception:
        logger.exception(
            "Could not apply Postgres schema -- check PGHOST/PGPORT/PGUSER/"
            "PGPASSWORD/PGDATABASE in .env. Audit logging will fail until this is fixed."
        )

    yield


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
    user_id: Optional[str] # who prompted this turn, passed through for the same reason


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
        # or not, so the original document is never lost.
        upload_meta = s3_storage.upload_file(
            file_bytes=file_bytes,
            original_filename=file.filename,
            content_type=file.content_type,
            upload_kind="purchase_order",
            session_id=session_id,
            user_id=user_id,
        )

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
# This lets a user upload any PDF/image and then just ask questions
# about it in normal chat (/api/chat, /query); the extracted text is
# stashed here per session_id and injected into the conversation once
# by generate_reply() below.
document_store: Dict[str, Dict[str, Any]] = {}  # session_id -> {filename, text, injected}

# session_id -> ERPIdentity: the real ERPNext user each chat session is
# acting as, resolved via /api/session/identify. generate_reply() binds
# this around the agent turn so every erp_data_tool call for that turn
# runs with THAT PERSON'S OWN ERPNext credentials -- and is therefore
# gated by Frappe's own, built-in role/permission engine -- instead of
# the shared service account. A session with nothing here just keeps
# using the shared service account, same as before this was wired up.
session_identities: Dict[str, ERPIdentity] = {}

class SessionIdentifyRequest(BaseModel):
    session_id: str
    erp_api_key: str
    erp_api_secret: str


@app.post("/api/session/identify")
async def identify_session(req: SessionIdentifyRequest):
    """Bind a real ERPNext user to a chat session, via their own personal
    API key/secret (ERPNext: User menu -> My Settings -> API Access ->
    Generate Keys). Call this once when a person starts or resumes a
    session, before /api/chat. From then on, every ERP tool call in that
    session is made with their own credentials and enforced by Frappe's
    own permission checks -- no custom ERPNext app required."""
    try:
        identity = erp_client.resolve_identity(req.erp_api_key, req.erp_api_secret)
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
):
    """Reads ANY PDF or image (not just Purchase Orders), extracts its
    full text, and stores it against session_id so the user can ask
    follow-up questions about it in normal chat."""
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

        upload_meta = s3_storage.upload_file(
            file_bytes=file_bytes,
            original_filename=file.filename,
            content_type=file.content_type,
            upload_kind="general_document",
            session_id=session_id,
            user_id=user_id,
        )

        extraction = llm_ocr_engine.extract_document_text(file_bytes=file_bytes, mime_type=file.content_type)

        document_store[session_id] = {
            "filename": file.filename,
            "text": extraction["text"],
            "injected": False,
        }

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


async def _execute_tool(
    tool_name: str,
    args: dict,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    prompt_text: Optional[str] = None,
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
    agent actually take" for later review."""
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

        with audit_log.time_tool_call() as elapsed:
            result = await tool.ainvoke(effective_args)

        if session_id:
            audit_log.log_turn(
                session_id, "tool", str(result), tool_name=tool_name, tool_args=effective_args,
                user_id=user_id, prompt_text=prompt_text, tool_status="success",
                duration_ms=elapsed(),
            )
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


def _plain_reply(history, task_context: Optional[str] = None) -> str:
    """Used when no ERP tool is needed for this turn (plain chat, or
    Q&A about an uploaded document). Unlike text_chain.invoke(), which
    only ever sees the single latest message, this sends the full
    trimmed history -- including any injected '[System note: the user
    uploaded a document...]' context from generate_reply() -- so a
    follow-up like 'solve problem 3 from that PDF' actually has the
    document content available instead of being answered blind."""
    system_parts = [assistant.llm.system_prompt, f"Current date: {datetime.now().astimezone():%Y-%m-%d}."]
    if task_context:
        system_parts.append(f"\nCurrent task in progress: {task_context}.")
    call_messages = [SystemMessage(content="\n".join(system_parts)), *history]
    response = assistant.llm.model.invoke(call_messages)
    return response.content


def _build_fallback_chart(results: list, query_lower: str) -> Optional[str]:
    """Generic, zero-hardcode fallback chart generator: parses ANY list of records
    returned by erp_data_tool, detects category/label keys and numeric/status keys,
    and dynamically builds bar, line, or pie chart specs."""
    if not results:
        return None

    IGNORED_KEYS = {"name", "docstatus", "idx", "owner", "creation", "modified"}

    for _tc, raw_result in reversed(results):
        raw_text = str(raw_result)
        try:
            cleaned = raw_text
            if cleaned.startswith("[{'type': 'text', 'text':"):
                parsed_wrapper = ast.literal_eval(cleaned)
                if isinstance(parsed_wrapper, list) and len(parsed_wrapper) > 0 and 'text' in parsed_wrapper[0]:
                    cleaned = parsed_wrapper[0]['text']

            data = ast.literal_eval(cleaned)

            if not (isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict)):
                continue

            first_row = data[0]
            avail_keys = [k for k in first_row.keys() if k.lower() not in IGNORED_KEYS]

            if not avail_keys:
                continue

            cat_keys = []
            num_keys = []
            for k in avail_keys:
                val = first_row.get(k)
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    num_keys.append(k)
                elif isinstance(val, str) and not val.replace(".", "", 1).isdigit():
                    cat_keys.append(k)
                elif val is not None:
                    try:
                        float(str(val))
                        num_keys.append(k)
                    except ValueError:
                        cat_keys.append(k)

            # Prioritize standard ERP label fields over generic text
            priority_cat = [
                "customer", "customer_name", "supplier", "supplier_name", 
                "item_code", "item_name", "production_item", "warehouse", 
                "territory", "item_group", "posting_date", "transaction_date"
            ]
            best_cat = next((k for p in priority_cat for k in cat_keys if k.lower() == p or p in k.lower()), cat_keys[0] if cat_keys else None)

            # Prioritize standard ERP financial & quantity fields over generic numbers
            priority_num = [
                "grand_total", "total", "net_total", "amount", 
                "qty", "produced_qty", "stock_qty", "rate", "valuation_rate"
            ]
            best_num = next((k for p in priority_num for k in num_keys if k.lower() == p or p in k.lower()), num_keys[0] if num_keys else None)

            # If all rows belong to a single category (e.g. single customer query like "West View Software Ltd."),
            # or if date fields are present, switch category key to date for a Timeline Line Chart!
            date_key = next((k for k in avail_keys if any(dw in k.lower() for dw in ["date", "posting", "transaction"])), None)
            if best_cat and date_key:
                unique_cats = {str(r.get(best_cat) or "").strip() for r in data}
                if len(unique_cats) <= 1:
                    best_cat = date_key

            # Strategy 1: Numerical aggregation (Category key + Numeric key) -> Bar or Line Chart
            if best_cat and best_num:
                label_key = best_cat
                value_key = best_num

                totals: dict[str, float] = {}
                for row in data:
                    label = str(row.get(label_key) or "Unknown").strip()
                    try:
                        num_val = float(row.get(value_key) or 0)
                    except (ValueError, TypeError):
                        num_val = 0.0
                    totals[label] = totals.get(label, 0.0) + num_val

                if totals:
                    is_timeline = any(w in label_key.lower() for w in ["date", "month", "year", "time", "day"])
                    if is_timeline:
                        sorted_items = sorted(totals.items(), key=lambda x: x[0])
                        x_axis = [item[0] for item in sorted_items]
                        series_data = [round(item[1], 2) for item in sorted_items]
                    else:
                        x_axis = list(totals.keys())
                        series_data = [round(v, 2) for v in totals.values()]

                    label_title = label_key.replace("_", " ").title()
                    value_title = value_key.replace("_", " ").title()
                    chart_type = "line" if is_timeline else "bar"

                    chart_spec = {
                        "type": chart_type,
                        "title": f"{value_title} Over Time" if is_timeline else f"{value_title} by {label_title}",
                        "xAxis": x_axis,
                        "series": [{"name": value_title, "data": series_data}]
                    }
                    return f"\n\n```chart\n{json.dumps(chart_spec, indent=2)}\n```"

            # Strategy 2: Categorical Frequency Breakdown (Status/Type key) -> Pie Chart
            if cat_keys:
                status_key = next((k for k in cat_keys if "status" in k.lower() or "group" in k.lower() or "type" in k.lower()), cat_keys[0])
                counts: dict[str, int] = {}
                for row in data:
                    cat_val = str(row.get(status_key) or "Unknown").strip()
                    counts[cat_val] = counts.get(cat_val, 0) + 1

                if counts:
                    title_name = status_key.replace("_", " ").title()
                    chart_spec = {
                        "type": "pie",
                        "title": f"{title_name} Distribution",
                        "labels": list(counts.keys()),
                        "values": list(counts.values())
                    }
                    return f"\n\n```chart\n{json.dumps(chart_spec, indent=2)}\n```"

        except Exception as e:
            logger.debug("Generic fallback chart parsing skipped: %s", e)
            continue

    return None


async def agent_node(state: ChatState) -> dict:
    """Retrieve-tools -> call-LLM -> call-tool turn, same logic as the
    original generate_reply, now working off the trimmed short-term
    history in state['messages'] and carrying pending_tool / task_slots
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
        reply = _plain_reply(history, task_context)
        return {"messages": [AIMessage(content=reply)]}

    # With only a handful of tools registered (as with ERP_Unified's
    # erp_data_tool / erp_describe_fields), similarity-threshold retrieval
    # does more harm than good: erp_data_tool's description is a broad,
    # generic, multi-doctype gateway, so its embedding similarity to any
    # ONE specific request ("create a lead for X") can dip below
    # min_score even though it's exactly the tool needed — which then
    # sends the turn to _plain_reply with NO tools bound at all, and the
    # model correctly (but unhelpfully) says it can't perform actions.
    # ToolRAG's filtering was built for larger tool lists where binding
    # everything confuses smaller local models; below this threshold just
    # bind every registered tool every turn instead of retrieving.
    if len(ALL_TOOLS) <= TOOL_RAG_BYPASS_THRESHOLD:
        candidate_tools = list(ALL_TOOLS)
    else:
        retrieval_query = f"{task_context}. {last_user_msg}" if task_context else last_user_msg
        candidate_tools = tool_rag.retrieve(retrieval_query)
    if not candidate_tools:
        reply = _plain_reply(history, task_context)
        return {"messages": [AIMessage(content=reply)]}

    logger.info("Tools selected for query: %s", [t.name for t in candidate_tools])

    llm_with_tools = assistant.llm.model.bind_tools(candidate_tools)
    import datetime
    current_date_str = datetime.date.today().strftime("%Y-%m-%d")
    system_parts = [
        assistant.llm.system_prompt,
        f"\nCURRENT SYSTEM DATE: {current_date_str}. Use this date when calculating date ranges for 'last 3 months', 'this month', or 'recent' records.",
        "\nSENIOR ERP EXPERT & BUSINESS INTELLIGENCE DIRECTIVE:",
        "- You are an expert ERP & Data Analyst. Think contextually about when visual charts add true executive value.",
        "- PROACTIVELY & AUTOMATICALLY generate visual charts (`create_bar_chart`, `create_pie_chart`, or `create_line_chart`) whenever the query involves tabular datasets, list overviews, status breakdowns, multi-record sales/purchase summaries, inventory counts, or financial trends — WITHOUT requiring the user to explicitly ask for 'chart' or 'graph'.",
        "- For single-record lookups (e.g. details of one specific order 'SAL-ORD-2026-00001'), single entity details, or general guidance questions, provide a clean executive response without forcing an unnecessary chart.",
        "\nEXECUTIVE REPORTING & FORMATTING STANDARDS:",
        "For all multi-record data responses, structure your output with clear headers:",
        "1. ### Executive Summary: High-level narrative with total metrics in bold (e.g. **₹6,43,000** or **6 orders**), completion percentages (e.g. **83%**), top customer/item contribution with percentage share, and operational insights.",
        "2. ### Order Breakdown (or ### Data Table): Clean, aligned Markdown table. All financial columns MUST include currency symbols (e.g. **₹20,000**), and dates MUST be cleanly formatted (e.g. 2026-08-05).",
        "3. Interactive Visual Spec: Embed the matching ```chart JSON block for any summary, list, or status comparison query.",
        "\nCHARTING & DATA REPORTING INSTRUCTIONS:",
        "- When generating charts, call the appropriate chart tool (`create_bar_chart`, `create_line_chart`, or `create_pie_chart`).",
        "- For bar charts (e.g. comparing sales revenue by customer), call `create_bar_chart` with x_axis_data (customer names) and series_data (revenue values).",
        "- For status distributions, call `create_pie_chart` with labels (status names) and values (counts).",
        "- For timeline trends over months/dates, call `create_line_chart` with x_axis_data (dates/months) and series_data (amounts).",
        "- Always retrieve real records from ERPNext using `erp_data_tool` first before generating charts or summaries.",
        "- When querying sales data with `erp_data_tool`, ALWAYS use `doctype='Sales Order'` (do NOT pass fieldnames like 'transaction_date' or 'grand_total' as the doctype parameter).",
        "\nPUBLIC-WEB RESEARCH DIRECTIVE:",
        "- For current public-web information, call `web_search`, then `web_fetch_page` when a full source page is needed.",
        "- For a company's verified public website or contact details, call `web_company_lookup`; never guess missing values.",
        "- Use `web_crawl` only when the user asks to inspect several related pages from a site."
    ]
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
        result = await _execute_tool(
            tool_call["name"], tool_call.get("args") or {},
            session_id=state.get("session_id"), user_id=state.get("user_id"),
            prompt_text=last_user_msg,
        )
        logger.info("Tool '%s' raw result: %s", tool_call["name"], result)
        results.append((tool_call, result))

    if not is_recovered:
        # Keep tools available while processing their results. Some requests
        # legitimately need more than one step, for example:
        # erp_describe_fields -> erp_data_tool(list). Execute every emitted
        # call before returning and persist only the final text response, so
        # short-term history can never contain an orphaned tool call.
        for tool_call, result in results:
            call_messages.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))

        max_followup_rounds = 4
        for round_number in range(max_followup_rounds + 1):
            final_response = llm_with_tools.invoke(call_messages)
            followup_calls = final_response.tool_calls
            if not followup_calls:
                break

            if round_number == max_followup_rounds:
                logger.warning("Tool-call round limit reached; composing a final response.")
                final_response = assistant.llm.model.invoke(call_messages)
                break

            call_messages.append(final_response)
            for tool_call in followup_calls:
                result = await _execute_tool(
                    tool_call["name"], tool_call.get("args") or {},
                    session_id=state.get("session_id"), user_id=state.get("user_id"),
                    prompt_text=last_user_msg,
                )
                logger.info("Tool '%s' raw result: %s", tool_call["name"], result)
                results.append((tool_call, result))
                call_messages.append(
                    ToolMessage(content=str(result), tool_call_id=tool_call["id"])
                )

        # Clean up any raw tool-argument JSON leaks (e.g. {"type": "bar", "x_axis_data": [...], "series_data": [...]})
        if final_response.content:
            cleaned_content = re.sub(
                r'```(?:json)?\s*\{[\s\S]*?"(?:x_axis_data|series_data)"[\s\S]*?\}\s*```',
                '',
                final_response.content
            )
            lines = []
            in_chart_block = False
            for line in cleaned_content.splitlines():
                if "```chart" in line:
                    in_chart_block = True
                elif "```" in line and in_chart_block:
                    in_chart_block = False

                if not in_chart_block and ('"x_axis_data"' in line or '"series_data"' in line):
                    continue
                lines.append(line)
            final_response.content = "\n".join(lines).strip()

        # 1. Auto-append executed chart tool result if missing from final response
        chart_tool_names = {"create_bar_chart", "create_line_chart", "create_pie_chart"}
        for tool_call, result in results:
            if tool_call["name"] in chart_tool_names:
                res_str = str(result)
                if "```chart" in res_str and "```chart" not in (final_response.content or ""):
                    final_response.content = (final_response.content or "").strip() + "\n\n" + res_str.strip()

        # 2. Fallback guarantee: if list/summary query produced data but no chart block, build one automatically
        if "```chart" not in (final_response.content or ""):
            fallback = _build_fallback_chart(results, last_user_msg.lower())
            if fallback:
                logger.info("Auto-charting fallback injected chart into final response.")
                final_response.content = (final_response.content or "").strip() + fallback

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

    result = await _execute_tool(
        tool_name, args, session_id=state.get("session_id"),
        user_id=state.get("user_id"),
        prompt_text=_last_human_message(state["messages"]),
    )
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


def build_agent_graph(checkpointer=None, use_platform_persistence=False):
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

    if use_platform_persistence:
        # LangGraph Studio / `langgraph dev` manage checkpointing
        # themselves and error out if the graph already has one baked in.
        return graph.compile()
    return graph.compile(checkpointer=checkpointer or MemorySaver())


agent_graph = build_agent_graph()  # used by your FastAPI server, unchanged


def build_studio_graph():
    """Entry point for langgraph.json / Studio only."""
    return build_agent_graph(use_platform_persistence=True)


async def generate_reply(text: str, session_id: str = "default", user_id: Optional[str] = None) -> str:
    """Returns the assistant's reply text for a user message.

    `session_id` is a LangGraph checkpointer thread_id: it carries the
    full conversation (short-term memory) and the current task label /
    any open slot-filling flow (task-context memory) across calls, in
    place of the old global `_pending_actions` dict.

    `user_id` identifies who prompted this turn -- pass it from your
    auth layer once you have one; defaults to "anonymous" so logging
    still works without auth wired up yet.

    Separately, every user message, assistant reply, and tool action for
    this session is written to `audit_log` (Postgres, durable across
    restarts), including how long each step took and who prompted it --
    see /api/audit/sessions below.
    """
    user_id = user_id or "anonymous"
    audit_log.log_turn(session_id, "user", text, user_id=user_id, prompt_text=text)

    initial_messages = [HumanMessage(content=text)]

    doc = document_store.get(session_id)
    if doc and not doc["injected"]:
        # Fires once, on the first chat turn after an /api/upload-document
        # call for this session -- after that it stays in the LangGraph
        # checkpointer's message history like any other turn, so it isn't
        # re-sent (and re-billed) on every subsequent message.
        doc_context = (
            f"[System note: the user uploaded a document named "
            f"'{doc['filename']}'. Its full extracted content is below -- "
            f"use it to answer any questions they ask about it.]\n\n"
            f"{doc['text'][:40000]}"
        )
        initial_messages = [SystemMessage(content=doc_context)] + initial_messages
        doc["injected"] = True

    config = {
        "configurable": {"thread_id": session_id},
        # Purely for LangSmith trace organization -- harmless no-op when
        # tracing is disabled. Lets you filter/search runs by session in
        # the LangSmith UI instead of scrolling through everything.
        "run_name": "magma-agent-turn",
        "tags": [f"session:{session_id}"],
        "metadata": {"session_id": session_id},
    }
    # Bind this session's real ERPNext identity (if one was set via
    # /api/session/identify) for the duration of the turn -- every
    # erp_data_tool call made anywhere in the graph below will run with
    # that person's own ERPNext credentials, so Frappe's own permission
    # engine enforces exactly what they're allowed to do. Sessions with
    # no identity bound behave exactly as before (shared service
    # account, no per-user RBAC).
    identity = session_identities.get(session_id)
    with audit_log.time_tool_call() as elapsed:
        with use_identity(identity):
            result = await agent_graph.ainvoke(
                {"messages": initial_messages, "session_id": session_id, "user_id": user_id},
                config,
            )
    reply = result["messages"][-1].content

    audit_log.log_turn(
        session_id, "assistant", reply, user_id=user_id, prompt_text=text,
        duration_ms=elapsed(),
    )
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
    user_id: Optional[str] = None  # who's asking -- pass from auth/frontend once available

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
        reply = await generate_reply(text, req.session_id, user_id=req.user_id)
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
    user_id: str = Form("anonymous"),

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
    response_text = await generate_reply(query_text, session_id, user_id=user_id)

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
