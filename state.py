"""
Global runtime singletons, in-memory session state, and tool registrations.
"""

import asyncio
import logging
from typing import Any, Dict, Optional

from config import (
    LLM_MODEL,
    MAX_HISTORY_TOKENS,
    SKILL_RAG_MIN_SCORE,
    SKILL_RAG_TOP_K,
    SKILLS_DIR,
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
from skills_engine import SkillManager
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
# Skills: workflow-specific instruction blocks (see skills_engine/ and
# skills/README.md). Loaded once at startup, same as ALL_TOOLS above;
# retrieved fresh per-turn in agent.py rather than living permanently in
# the static system prompt.
# ---------------------------------------------------------------------
logger.info("Loading skills from '%s'...", SKILLS_DIR)
skill_manager = SkillManager(SKILLS_DIR, top_k=SKILL_RAG_TOP_K, min_score=SKILL_RAG_MIN_SCORE)
if skill_manager.skills:
    logger.info(
        "Loaded %d skill(s): %s",
        len(skill_manager.skills),
        ", ".join(s.id for s in skill_manager.skills),
    )
else:
    logger.info("No skills found in '%s' -- add SKILL.md folders there to enable skill guidance.", SKILLS_DIR)

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
# session_id -> [ {filename, file_type, text, ...}, ... ]
# The store and its helpers live in document_context.py (dependency-free, so it
# can be unit-tested); re-exported here so existing `state.document_store`
# callers keep working. stream_agent_turn() renders it into the system prompt
# via build_document_context() -- before this, uploads were stored here but
# never read back, so the model never saw them.
from document_context import (  # noqa: E402
    add_session_document,
    build_document_context,
    clear_session_documents,
    document_store,
    get_session_documents,
)

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

    # For erp_data_tool write operations, ensure any stray top-level doc fields
    # are safely packaged into cleaned["data"]
    if tool_name == "erp_data_tool" and cleaned.get("operation") in ("create", "update"):
        known_tool_params = set(fields.keys())
        extra_doc_fields = {k: v for k, v in cleaned.items() if k not in known_tool_params}
        if extra_doc_fields:
            data_dict = dict(cleaned.get("data") or {})
            for k, v in extra_doc_fields.items():
                data_dict.setdefault(k, v)
                cleaned.pop(k, None)
            cleaned["data"] = data_dict

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