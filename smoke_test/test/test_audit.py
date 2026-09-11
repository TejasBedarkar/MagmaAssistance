"""
Checks: GET /api/audit/sessions, /api/audit/sessions/{id}, /api/audit/export

Uses ctx["chat_session_id"] if test_chat.py already ran and populated
it (so there's a real transcript to fetch); falls back to "default"
otherwise, in which case a 404 on the single-session lookup is a PASS,
not a FAIL -- it just means no turn has been logged under that id yet.

NOTE: server.py imports `db.postgres_audit_log as audit_log`, which is
now SQLite-backed (ARCHITECTURE.md P2 "Audit -> SQLite" is done) and
needs no external database or PG* env vars -- a failure here is a real
bug, not a missing-Postgres environment issue.
"""

import json
import urllib.error

from smoke.client import Client, ClientError, TestResult, timed


def _list_sessions(client: Client) -> TestResult:
    resp = client.get("/api/audit/sessions")
    body = json.loads(resp.read())
    ok = resp.status == 200 and "sessions" in body
    return TestResult("audit.list_sessions", ok, str(body)[:200])


def _get_transcript(client: Client, session_id: str) -> TestResult:
    try:
        resp = client.get(f"/api/audit/sessions/{session_id}")
        body = json.loads(resp.read())
        ok = resp.status == 200 and "transcript" in body
        return TestResult("audit.get_transcript", ok, str(body)[:200])
    except ClientError as exc:
        # a 404 is expected/acceptable if no turn has been logged for
        # this session_id yet -- only non-404 is a real failure
        ok = "404" in str(exc)
        return TestResult("audit.get_transcript", ok, f"{exc} (404 acceptable if session has no logged turns)")


def _export(client: Client, session_id: str) -> TestResult:
    resp = client.get(f"/api/audit/export?session_id={session_id}")
    ok = resp.status == 200
    return TestResult("audit.export", ok, f"status={resp.status}")


def run(client: Client, ctx: dict) -> list[TestResult]:
    session_id = ctx.get("chat_session_id", "default")
    return [
        timed("audit.list_sessions", _list_sessions, client),
        timed("audit.get_transcript", _get_transcript, client, session_id),
        timed("audit.export", _export, client, session_id),
    ]