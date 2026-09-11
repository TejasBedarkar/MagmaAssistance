"""
MagmaAssistance Backend Server.

FastAPI application entrypoint, lifespan configuration, CORS middleware,
and router registration.
"""

from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent import (
    _describe_pending_action,
    _execute_tool,
    _is_write_approval,
    _is_write_call,
    _is_write_rejection,
    _stream_chat_completion,
    _stream_full_reply,
    stream_agent_turn,
)
from history import load_stream_history, save_stream_history
from llm_client import (
    _clean_schema_for_openai,
    convert_message_to_dict,
    OpenAIChatModel,
)
from routes.audit import router as audit_router
from routes.chat import router as chat_router
from routes.session import router as session_router
from routes.upload import router as upload_router
from routes.voice import router as voice_router
import state
from Voice.ws_voice import register_voice_ws

# ---------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
for _voice_logger in ("ws_voice", "openai-stt", "openai-tts"):
    logging.getLogger(_voice_logger).setLevel(logging.DEBUG)

logger = logging.getLogger("agent-server")

# ---------------------------------------------------------------------
# LangSmith tracing (optional)
# ---------------------------------------------------------------------
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


# ---------------------------------------------------------------------
# FastAPI Application Lifespan
# ---------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes persistent conversation memory via SQLite checkpointer."""
    import aiosqlite
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    state._checkpoint_conn = await aiosqlite.connect("stream_history.sqlite", isolation_level=None)
    try:
        state.saver = AsyncSqliteSaver(state._checkpoint_conn)
        await state.saver.setup()
        logger.info("AsyncSqliteSaver persistent memory ready.")
        yield
    finally:
        await state._checkpoint_conn.close()
        state._checkpoint_conn = None
        state.saver = None


app = FastAPI(title="MagmaAssistance Backend", lifespan=lifespan)

# ---------------------------------------------------------------------
# CORS Middleware
# ---------------------------------------------------------------------
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
    logger.warning(
        "ALLOWED_ORIGINS is not set -- CORS is wide open (any website can call "
        "this API from its own JS). Fine for local dev; before real users touch "
        "this, set ALLOWED_ORIGINS in .env to the real frontend/backend origins."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOW_ORIGIN_REGEX,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# Mount Routers
# ---------------------------------------------------------------------
app.include_router(chat_router)
app.include_router(voice_router)
app.include_router(upload_router)
app.include_router(session_router)
app.include_router(audit_router)

# Register Voice WebSocket
register_voice_ws(
    app,
    stream_agent_turn,
    state.assistant.tts,
    logger,
    load_stream_history,
    save_stream_history,
)

# Attach shared state to app.state for WebSocket lookup
app.state.session_identities = state.session_identities
app.state.all_tools_list = state.ALL_TOOLS
app.state.execute_tool_fn = _execute_tool
app.state.load_stream_history_fn = load_stream_history


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------
# Backward-compatibility re-exports for external/legacy callers
# ---------------------------------------------------------------------
session_identities = state.session_identities
document_store = state.document_store
_PENDING_APPROVALS = state._PENDING_APPROVALS
tool_map = state.tool_map
ALL_TOOLS = state.ALL_TOOLS
assistant = state.assistant
safe_create_task = state.safe_create_task

__all__ = [
    "app",
    "stream_agent_turn",
    "_execute_tool",
    "load_stream_history",
    "save_stream_history",
    "OpenAIChatModel",
    "session_identities",
    "document_store",
    "_PENDING_APPROVALS",
    "tool_map",
    "ALL_TOOLS",
    "assistant",
    "safe_create_task",
    "convert_message_to_dict",
    "_clean_schema_for_openai",
    "_describe_pending_action",
    "_is_write_call",
    "_is_write_approval",
    "_is_write_rejection",
    "_stream_chat_completion",
    "_stream_full_reply",
]

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8050))
    logger.info(f"Starting server on port {port}...")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)