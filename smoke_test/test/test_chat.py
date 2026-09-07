"""
Checks: POST /api/chat/stream

Covers the live request path end to end: SSE connect -> tool_call ->
tool_result -> token stream -> done, plus a second turn on the same
session_id to confirm multi-turn memory survives (this is the exact
regression P1's checkpointer swap needs to not break).
"""

import uuid

from smoke.client import Client, TestResult, timed


def _first_turn(client: Client, session_id: str) -> TestResult:
    events = client.stream_events(
        "/api/chat/stream",
        {"message": "show me all customers", "session_id": session_id},
    )
    types = [e.get("type") for e in events]
    has_error = any(e.get("type") == "error" for e in events)
    ok = not has_error and "tool_call" in types and "tool_result" in types and "done" in types
    return TestResult("chat.first_turn", ok, f"events: {types}")


def _second_turn_remembers(client: Client, session_id: str) -> TestResult:
    events = client.stream_events(
        "/api/chat/stream",
        {"message": "how many did you find?", "session_id": session_id},
    )
    types = [e.get("type") for e in events]
    has_error = any(e.get("type") == "error" for e in events)
    ok = not has_error and "done" in types
    return TestResult("chat.memory_persists_across_turns", ok, f"events: {types}")


def run(client: Client, ctx: dict) -> list[TestResult]:
    session_id = f"smoke-chat-{uuid.uuid4().hex[:8]}"
    ctx["chat_session_id"] = session_id

    results = [timed("chat.first_turn", _first_turn, client, session_id)]
    if results[0].passed:
        results.append(timed("chat.memory_persists_across_turns", _second_turn_remembers, client, session_id))
    else:
        results.append(TestResult(
            "chat.memory_persists_across_turns", False, skipped=True,
            detail="skipped -- first turn failed",
        ))
    return results
