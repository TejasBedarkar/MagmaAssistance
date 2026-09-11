"""
db/postgres_audit_log.py

SQLite-backed audit trail (module name kept as `postgres_audit_log` so
`import db.postgres_audit_log as audit_log` in server.py doesn't need to
change). Replaces the normalized Postgres schema (overview / details /
tools / tools_sec / tools_details / token_details) with a single flat
`conversation_log` table, on the same design as the orphan root
`audit_log.py` this is based on -- durable, queryable, no extra
dependency (sqlite3 is stdlib), no external database to stand up.

Dropped along with Postgres: the `details`/token-budget machinery
(`token_details`, record_token_usage()/get_token_details()) and
`long_term_memory` -- neither was wired up to anything on the agent
side, and nothing in server.py called them.

Public API is unchanged on purpose -- log_turn/get_transcript/
list_sessions/export_json/write_json_export/time_tool_call/
record_file_upload keep the same names, signatures, and return shapes
server.py already calls, so its call sites don't need to change.

Swap DB_PATH for a shared/networked path if multiple server processes
need to log to the same place.
"""

import json
import logging
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("audit-log")

DB_PATH = Path(__file__).parent / "audit_log.db"

_lock = threading.Lock()  # sqlite3 connections aren't thread-safe to share


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS conversation_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,          -- 'user' | 'assistant' | 'tool' | 'system'
                content TEXT NOT NULL,
                tool_name TEXT,
                tool_args TEXT,              -- JSON, only set when role = 'tool'
                user_id TEXT,
                prompt_text TEXT,            -- the user question this row is answering
                tool_status TEXT,            -- success | error | not_found | permission_denied |
                                              -- awaiting_approval | approved_executed | rejected
                error_message TEXT,
                duration_ms INTEGER,         -- tool execution time
                created_at TEXT NOT NULL     -- ISO 8601 UTC
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversation_log_session ON conversation_log(session_id, id)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS file_uploads (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                user_id TEXT,
                original_filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                checksum_sha256 TEXT NOT NULL,
                upload_kind TEXT NOT NULL,   -- purchase_order | general_document | audio
                status TEXT NOT NULL,        -- pending | processing | processed | failed
                s3_bucket TEXT NOT NULL,
                s3_key TEXT NOT NULL,
                s3_region TEXT NOT NULL,
                s3_version_id TEXT,
                extracted_metadata TEXT,     -- JSON
                uploaded_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_file_uploads_session ON file_uploads(session_id)"
        )


def log_turn(
    session_id: str,
    role: str,
    content: str,
    tool_name: Optional[str] = None,
    tool_args: Optional[dict] = None,
    user_id: Optional[str] = None,
    prompt_text: Optional[str] = None,
    tool_status: Optional[str] = None,
    error_message: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> None:
    """Appends one entry. Never raises -- a logging failure should not take
    down the actual conversation turn it's trying to record."""
    try:
        with _lock, _connect() as conn:
            conn.execute(
                "INSERT INTO conversation_log "
                "(session_id, role, content, tool_name, tool_args, user_id, "
                "prompt_text, tool_status, error_message, duration_ms, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    session_id,
                    role,
                    content,
                    tool_name,
                    json.dumps(tool_args) if tool_args is not None else None,
                    user_id,
                    prompt_text,
                    tool_status,
                    error_message,
                    duration_ms,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to write audit log entry for session '%s'", session_id)


@contextmanager
def time_tool_call():
    """Context manager yielding a callable that returns elapsed ms so far.

    Usage:
        with time_tool_call() as elapsed:
            result = await tool.ainvoke(args)
        audit_log.log_turn(..., duration_ms=elapsed())
    """
    start = time.perf_counter()
    yield lambda: int((time.perf_counter() - start) * 1000)


def get_transcript(session_id: str) -> list[dict[str, Any]]:
    """Full ordered transcript for one session -- what was said and every
    tool action taken, oldest first."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT role, content, tool_name, tool_args, user_id, prompt_text, "
            "tool_status, error_message, duration_ms, created_at "
            "FROM conversation_log WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
    return [
        {
            "role": r["role"],
            "content": r["content"],
            "tool_name": r["tool_name"],
            "tool_args": json.loads(r["tool_args"]) if r["tool_args"] else None,
            "user_id": r["user_id"],
            "prompt_text": r["prompt_text"],
            "tool_status": r["tool_status"],
            "error_message": r["error_message"],
            "duration_ms": r["duration_ms"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def list_sessions(since: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    """One row per session: id, message count, first/last activity --
    a session index for an audit dashboard. `since` is an ISO date/datetime
    string (e.g. '2026-07-01'); only sessions active on or after it are
    returned."""
    query = (
        "SELECT session_id, COUNT(*) AS turn_count, "
        "MIN(created_at) AS started_at, MAX(created_at) AS last_active_at "
        "FROM conversation_log"
    )
    params: tuple = ()
    if since:
        query += " WHERE created_at >= ?"
        params = (since,)
    query += " GROUP BY session_id ORDER BY last_active_at DESC LIMIT ?"
    params = params + (limit,)

    with _lock, _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def export_json(session_id: Optional[str] = None) -> dict:
    """Builds a JSON-serializable audit export.

    - session_id given -> {"exported_at", "session_id", "turn_count", "transcript": [...]}
    - session_id omitted -> {"exported_at", "session_count", "sessions": [
          {"session_id", "turn_count", "started_at", "last_active_at", "transcript": [...]}, ...
      ]}  -- every session, each with its full transcript inlined.
    """
    exported_at = datetime.now(timezone.utc).isoformat()

    if session_id:
        transcript = get_transcript(session_id)
        return {
            "exported_at": exported_at,
            "session_id": session_id,
            "turn_count": len(transcript),
            "transcript": transcript,
        }

    sessions = list_sessions(limit=10_000)
    for s in sessions:
        s["transcript"] = get_transcript(s["session_id"])
    return {
        "exported_at": exported_at,
        "session_count": len(sessions),
        "sessions": sessions,
    }


def write_json_export(path: str, session_id: Optional[str] = None) -> str:
    """Writes export_json(...) to `path` as pretty-printed JSON and returns
    the path, for a CLI dump or a FastAPI FileResponse to hand back."""
    data = export_json(session_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return path


# ---------------------------------------------------------------------
# File upload metadata (paired with storage/s3_storage.py) -- unchanged
# in shape from the Postgres version; file content lives in S3, only
# metadata is recorded here.
# ---------------------------------------------------------------------

def record_file_upload(
    session_id: Optional[str],
    user_id: Optional[str],
    original_filename: str,
    content_type: str,
    file_size_bytes: int,
    checksum_sha256: str,
    upload_kind: str,
    s3_bucket: str,
    s3_key: str,
    s3_region: str,
    s3_version_id: Optional[str] = None,
    extracted_metadata: Optional[dict] = None,
    status: str = "processed",
) -> str:
    """Inserts one file_uploads row and returns its id (uuid string).
    Call this right after storage.s3_storage.upload_file() succeeds."""
    row_id = str(uuid.uuid4())
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO file_uploads "
            "(id, session_id, user_id, original_filename, content_type, "
            "file_size_bytes, checksum_sha256, upload_kind, status, "
            "s3_bucket, s3_key, s3_region, s3_version_id, extracted_metadata, uploaded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                row_id,
                session_id,
                user_id,
                original_filename,
                content_type,
                file_size_bytes,
                checksum_sha256,
                upload_kind,
                status,
                s3_bucket,
                s3_key,
                s3_region,
                s3_version_id,
                json.dumps(extracted_metadata or {}),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    return row_id


# ---------------------------------------------------------------------
# Tool success/failure summary -- "did it work or fail how many times",
# derived from conversation_log's tool_status column rather than a
# running counter so it can't drift out of sync with the raw log.
# ---------------------------------------------------------------------

def tool_stats(session_id: Optional[str] = None) -> list[dict[str, Any]]:
    """Per-tool success/fail/not_found counts, optionally scoped to one
    session. Backs a 'which tools worked, which didn't, how often'
    view for an audit dashboard."""
    query = (
        "SELECT tool_name, "
        "SUM(CASE WHEN tool_status = 'success' THEN 1 ELSE 0 END) AS success_count, "
        "SUM(CASE WHEN tool_status = 'error' THEN 1 ELSE 0 END) AS error_count, "
        "SUM(CASE WHEN tool_status = 'not_found' THEN 1 ELSE 0 END) AS not_found_count, "
        "COUNT(*) AS total_calls "
        "FROM conversation_log WHERE tool_name IS NOT NULL"
    )
    params: tuple = ()
    if session_id:
        query += " AND session_id = ?"
        params = (session_id,)
    query += " GROUP BY tool_name ORDER BY total_calls DESC"

    with _lock, _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


init_db()