"""
db/postgres_audit_log.py

Postgres-backed replacement for the SQLite audit_log.py. Same job --
durable, queryable record of every session -- but now:
  * records which tool was selected, its args/result and how long it took
    (duration_ms)
  * records who prompted each turn (user_id), not just the session id
  * uses a connection pool instead of one sqlite file, so multiple
    server processes/workers can log to the same place safely

Drop-in usage: `import db.postgres_audit_log as audit_log` in server.py
instead of `import audit_log` -- log_turn/get_transcript/list_sessions/
export_json keep the same names and shapes, plus new
`log_tool_call(..., duration_ms=...)` and `time_tool_call()` helpers.

Requires:
    pip install psycopg2-binary python-dotenv
    PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE set in .env (see .env.example)
"""

import json
import logging
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Optional

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool
from dotenv import load_dotenv

load_dotenv()

from db.init_db import get_connection_params

logger = logging.getLogger("audit-log")

_MIN_CONN = int(os.getenv("AUDIT_DB_POOL_MIN", "1"))
_MAX_CONN = int(os.getenv("AUDIT_DB_POOL_MAX", "10"))

_pool: Optional[pg_pool.ThreadedConnectionPool] = None


def _get_pool() -> pg_pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        # Raises with a clear "which env var is missing" message if
        # PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE aren't all set.
        params = get_connection_params()
        _pool = pg_pool.ThreadedConnectionPool(_MIN_CONN, _MAX_CONN, **params)
    return _pool


@contextmanager
def _conn():
    conn = _get_pool().getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _get_pool().putconn(conn)


def ensure_session(session_id: str, user_id: Optional[str] = None) -> None:
    """Upserts the session row and bumps last_active_at. Called on every
    turn so `sessions` always reflects who owns/last touched a thread."""
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions (session_id, user_id)
                VALUES (%s, %s)
                ON CONFLICT (session_id) DO UPDATE SET
                    last_active_at = now(),
                    user_id = COALESCE(EXCLUDED.user_id, sessions.user_id)
                """,
                (session_id, user_id),
            )
    except Exception:
        logger.exception("Failed to upsert session '%s'", session_id)


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
    """Appends one audit_log row. Never raises -- a logging failure must
    never take down the actual conversation turn it's trying to record.

    role: 'user' | 'assistant' | 'tool' | 'system'
    user_id: who prompted the underlying request (thread through from the
             originating user message to any tool calls it triggers)
    prompt_text: the user question this row is answering, if not `role='user'` itself
    duration_ms: how long this step took (LLM call latency / tool execution time)
    """
    try:
        ensure_session(session_id, user_id)
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO audit_log (
                    session_id, role, user_id, prompt_text, content,
                    tool_name, tool_args, tool_status, error_message, duration_ms
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    role,
                    user_id,
                    prompt_text,
                    content,
                    tool_name,
                    json.dumps(tool_args) if tool_args is not None else None,
                    tool_status,
                    error_message,
                    duration_ms,
                ),
            )
    except Exception:
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
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT role, user_id, prompt_text, content, tool_name, tool_args,
                   tool_status, error_message, duration_ms, created_at
            FROM audit_log
            WHERE session_id = %s
            ORDER BY id ASC
            """,
            (session_id,),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def list_sessions(since: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    query = """
        SELECT s.session_id, s.user_id, s.started_at, s.last_active_at,
               COUNT(a.id) AS turn_count
        FROM sessions s
        LEFT JOIN audit_log a ON a.session_id = s.session_id
    """
    params: list = []
    if since:
        query += " WHERE s.last_active_at >= %s"
        params.append(since)
    query += " GROUP BY s.session_id ORDER BY s.last_active_at DESC LIMIT %s"
    params.append(limit)

    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def export_json(session_id: Optional[str] = None) -> dict:
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
    data = export_json(session_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    return path


# ---------------------------------------------------------------------
# File upload metadata (paired with storage/s3_storage.py)
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
    The parent session is created in the same transaction first so a new
    upload session cannot violate file_uploads_session_id_fkey."""
    with _conn() as conn, conn.cursor() as cur:
        if session_id:
            cur.execute(
                """
                INSERT INTO sessions (session_id, user_id)
                VALUES (%s, %s)
                ON CONFLICT (session_id) DO NOTHING
                """,
                (session_id, user_id),
            )
        cur.execute(
            """
            INSERT INTO file_uploads (
                session_id, user_id, original_filename, content_type,
                file_size_bytes, checksum_sha256, upload_kind, status,
                s3_bucket, s3_key, s3_region, s3_version_id, extracted_metadata
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
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
            ),
        )
        row_id = cur.fetchone()[0]
    return str(row_id)


def list_file_uploads(session_id: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    query = "SELECT * FROM file_uploads"
    params: list = []
    if session_id:
        query += " WHERE session_id = %s"
        params.append(session_id)
    query += " ORDER BY uploaded_at DESC LIMIT %s"
    params.append(limit)

    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [dict(r) for r in rows]
