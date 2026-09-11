"""
Checks: POST /api/chat/stream, exercising the generic erp_data_tool
against several read-only doctypes.

Deliberately read-only ("show me", "list") -- no create/update/submit
prompts here. Write-path checks belong in a separate, explicitly opt-in
module once the write-approval gate (P1) exists, since they mutate real
ERP data.
"""

import uuid

from smoke.client import Client, TestResult, timed

PROMPTS = [
    ("customers", "show me all customers"),
    ("items", "list all items"),
    ("sales_orders", "show me open sales orders"),
]


def _check_prompt(client: Client, name: str, prompt: str) -> TestResult:
    session_id = f"smoke-tool-{name}-{uuid.uuid4().hex[:6]}"
    events = client.stream_events(
        "/api/chat/stream",
        {"message": prompt, "session_id": session_id},
    )
    types = [e.get("type") for e in events]
    has_error = any(e.get("type") == "error" for e in events)
    ok = not has_error and "tool_call" in types and "done" in types
    return TestResult(f"tool_calls.{name}", ok, f"events: {types}")


def run(client: Client, ctx: dict) -> list[TestResult]:
    if ctx.get("skip_llm"):
        return [TestResult(f"tool_calls.{name}", False, skipped=True, detail="skipped -- --skip-llm")
                for name, _ in PROMPTS]
    return [timed(f"tool_calls.{name}", _check_prompt, client, name, prompt) for name, prompt in PROMPTS]
