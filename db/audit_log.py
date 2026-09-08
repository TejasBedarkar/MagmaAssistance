"""
db/audit_log.py

SQLite-backed audit trail for MagmaAssistance.
Replaces legacy PostgreSQL audit backend with zero external dependencies (stdlib sqlite3).
Persists sessions, conversation turns, tool executions, and file upload metadata.
"""

import json
import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("audit-log")

DB_PATH = Path(os.getenv("AUDIT_DB_PATH", "magma_audit.sqlite"))
_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def init_db() -> None:
    """Creates SQLite audit tables and indexes if they do not exist."""
    with _lock, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                user_id TEXT,
                started_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversation_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                user_id TEXT,
                role TEXT NOT NULL,
                prompt_text TEXT,
                content TEXT NOT NULL,
                tool_name TEXT,
                tool_args TEXT,
                tool_status TEXT,
                error_message TEXT,
                duration_ms INTEGER,
                tries INTEGER,
                tokens_used INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );

            CREATE INDEX IF NOT EXISTS idx_log_session ON conversation_log(session_id, id);
            CREATE INDEX IF NOT EXISTS idx_log_tool ON conversation_log(tool_name);
            CREATE INDEX IF NOT EXISTS idx_log_created ON conversation_log(created_at);

            CREATE TABLE IF NOT EXISTS file_uploads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                user_id TEXT,
                original_filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                checksum_sha256 TEXT NOT NULL,
                upload_kind TEXT NOT NULL,
                status TEXT NOT NULL,
                s3_bucket TEXT NOT NULL,
                s3_key TEXT NOT NULL,
                s3_region TEXT NOT NULL,
                s3_version_id TEXT,
                extracted_metadata TEXT,
                uploaded_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_file_uploads_session ON file_uploads(session_id);
            """
        )
    logger.info("SQLite audit database ready at %s", DB_PATH)


def ensure_session(session_id: str, user_id: Optional[str] = None) -> None:
    """Inserts or updates session activity timestamp."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _lock, _connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (session_id, user_id, started_at, last_active_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (session_id) DO UPDATE SET
                    last_active_at = excluded.last_active_at,
                    user_id = COALESCE(excluded.user_id, sessions.user_id)
                """,
                (session_id, user_id, now, now),
            )
    except Exception:
        logger.exception("Failed to ensure session '%s'", session_id)


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
    tries: Optional[int] = None,
    tokens_used: Optional[int] = None,
) -> None:
    """Appends one conversation or tool turn to the audit log."""
    try:
        ensure_session(session_id, user_id)
        now = datetime.now(timezone.utc).isoformat()
        serialized_args = json.dumps(tool_args) if isinstance(tool_args, dict) else (str(tool_args) if tool_args is not None else None)
        with _lock, _connect() as conn:
            conn.execute(
                """
                INSERT INTO conversation_log (
                    session_id, user_id, role, prompt_text, content,
                    tool_name, tool_args, tool_status, error_message,
                    duration_ms, tries, tokens_used, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id, user_id, role, prompt_text, content,
                    tool_name, serialized_args, tool_status or ("success" if tool_name else None),
                    error_message, duration_ms, tries, tokens_used, now
                ),
            )
    except Exception:
        logger.exception("Failed to write audit turn for session '%s'", session_id)


@contextmanager
def time_tool_call():
    """Context manager yielding a callable returning elapsed ms so far."""
    start = time.perf_counter()
    yield lambda: int((time.perf_counter() - start) * 1000)


def get_transcript(session_id: str) -> list[dict[str, Any]]:
    """Returns ordered transcript of all turns and tool calls for a session."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            """
            SELECT role, user_id, prompt_text, content,
                   tool_name, tool_args, tool_status, error_message,
                   duration_ms, created_at, tries, tokens_used
            FROM conversation_log
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()

    result = []
    for r in rows:
        item = dict(r)
        if item.get("tool_args"):
            try:
                item["tool_args"] = json.loads(item["tool_args"])
            except Exception:
                pass
        result.append(item)
    return result


def list_sessions(since: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    """Returns summary list of active sessions with turn counts and timestamps."""
    query = """
        SELECT s.session_id, s.user_id, s.started_at, s.last_active_at,
               COUNT(c.id) AS turn_count
        FROM sessions s
        LEFT JOIN conversation_log c ON c.session_id = s.session_id
    """
    params: list = []
    if since:
        query += " WHERE s.last_active_at >= ?"
        params.append(since)
    query += " GROUP BY s.session_id ORDER BY s.last_active_at DESC LIMIT ?"
    params.append(limit)

    with _lock, _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def export_json(session_id: Optional[str] = None) -> dict:
    """Builds a JSON-serializable export of session transcript(s)."""
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
    """Writes export_json to disk as formatted JSON."""
    data = export_json(session_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    return path


def tool_stats(session_id: Optional[str] = None) -> list[dict[str, Any]]:
    """Aggregates execution counts and success/error metrics per tool."""
    query = """
        SELECT tool_name,
               SUM(CASE WHEN tool_status = 'success' THEN 1 ELSE 0 END) AS success_count,
               SUM(CASE WHEN tool_status = 'error' THEN 1 ELSE 0 END) AS error_count,
               SUM(CASE WHEN tool_status = 'not_found' THEN 1 ELSE 0 END) AS not_found_count,
               COUNT(*) AS total_calls
        FROM conversation_log
        WHERE tool_name IS NOT NULL
    """
    params: list = []
    if session_id:
        query += " AND session_id = ?"
        params.append(session_id)
    query += " GROUP BY tool_name ORDER BY total_calls DESC"

    with _lock, _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


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
    """Inserts a file upload record and returns its string row ID."""
    now = datetime.now(timezone.utc).isoformat()
    if session_id:
        ensure_session(session_id, user_id)
    with _lock, _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO file_uploads (
                session_id, user_id, original_filename, content_type,
                file_size_bytes, checksum_sha256, upload_kind, status,
                s3_bucket, s3_key, s3_region, s3_version_id, extracted_metadata,
                uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                now,
            ),
        )
        row_id = cursor.lastrowid
    return str(row_id)


def list_file_uploads(session_id: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    """Returns list of uploaded files, optionally filtered by session."""
    query = "SELECT * FROM file_uploads"
    params: list = []
    if session_id:
        query += " WHERE session_id = ?"
        params.append(session_id)
    query += " ORDER BY uploaded_at DESC LIMIT ?"
    params.append(limit)

    with _lock, _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]
