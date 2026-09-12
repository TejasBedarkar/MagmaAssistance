"""
Global runtime singletons, in-memory session state, and tool registrations.
"""

import asyncio
import logging
from typing import Any, Dict, Optional

from config import (
    LLM_MODEL,
    MAX_HISTORY_TOKENS,
    TOOL_RAG_BYPASS_THRESHOLD,
    TOOL_RAG_MIN_SCORE,
    TOOL_RAG_TOP_K,
    TTS_VOICE,
    WHISPER_MODEL,
)
from ERP.erp_client import ERPIdentity
from ERP.tool_rag import ToolRAG
from ERP.tools.DashboardUI_tools import DASHBOARD_UI_TOOLS
from ERP_Unified.tools import ERP_UNIFIED_TOOLS
from llm_client import OpenAIChatModel  # ensures LLM.model property is attached
from Main import VoiceAssistant
from web.web_tool import WEB_TOOLS

logger = logging.getLogger("agent-server")

# ---------------------------------------------------------------------
# Registered agent tools
# ---------------------------------------------------------------------
ALL_TOOLS = [*ERP_UNIFIED_TOOLS, *DASHBOARD_UI_TOOLS, *WEB_TOOLS]

tool_rag = None
tool_map: Dict[str, Any] = {}
if ALL_TOOLS:
    tool_map = {tool.name: tool for tool in ALL_TOOLS}
    if len(ALL_TOOLS) > TOOL_RAG_BYPASS_THRESHOLD:
        logger.info("Indexing %d local agent tool(s) for retrieval...", len(ALL_TOOLS))
        tool_rag = ToolRAG(ALL_TOOLS, top_k=TOOL_RAG_TOP_K, min_score=TOOL_RAG_MIN_SCORE)
    else:
        logger.info("Skipping HuggingFace ToolRAG indexing (only %d tools).", len(ALL_TOOLS))
else:
    logger.info("No ERP tools registered.")

# ---------------------------------------------------------------------
# VoiceAssistant instance (STT + TTS + LLM chat)
# ---------------------------------------------------------------------
logger.info("Loading VoiceAssistant agent (STT=%s, LLM=%s)...", WHISPER_MODEL, LLM_MODEL)
assistant = VoiceAssistant(
    whisper_model=WHISPER_MODEL,
    llm_model=LLM_MODEL,
    tts_voice=TTS_VOICE,
    speak_replies=False,
)

# ---------------------------------------------------------------------
# Async background tasks & LangGraph checkpointer connection
# ---------------------------------------------------------------------
_bg_tasks = set()
_checkpoint_conn = None  # global aiosqlite connection
saver = None             # AsyncSqliteSaver instance set up in server lifespan


def safe_create_task(coro):
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return task


# ---------------------------------------------------------------------
# Per-session runtime state
# ---------------------------------------------------------------------
# session_id -> {filename, text, injected}
document_store: Dict[str, Dict[str, Any]] = {}

# session_id -> ERPIdentity (resolved user identity for RBAC)
session_identities: Dict[str, ERPIdentity] = {}

# Write-approval proposals are persisted in db/audit_log.db (pending_approvals
# table) rather than kept in memory here -- an in-memory dict didn't survive
# a backend restart between "shall I proceed?" and the user's "yes", which
# silently dropped the pending write and let the agent improvise a false
# success. See db.postgres_audit_log.save_pending_approval / get_pending_approval
# / clear_pending_approval.


# ---------------------------------------------------------------------
# Memory and tool argument sanitization helpers
# ---------------------------------------------------------------------
def _approx_tokens(messages: list) -> int:
    return sum(len(str(m.content)) // 4 for m in messages)


def _flatten_scalar(value):
    """Some local models occasionally wrap a plain scalar argument in a dict."""
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

        # Dict unwrapping
        if isinstance(value, dict) and expects_scalar:
            value = _flatten_scalar(value)
            cleaned[field_name] = value

        # Remove empty strings for numeric fields
        if value == "":
            if int in inner_types or float in inner_types:
                cleaned.pop(field_name, None)

    return cleaned
