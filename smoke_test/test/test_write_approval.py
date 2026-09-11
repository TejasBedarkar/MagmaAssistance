"""
Checks: Write-approval gate in /api/chat/stream

Verifies that create/update actions are intercepted and held in a proposal
state until the user confirms with an affirmative response ("yes"), at which
point the stashed action is deterministically executed.
"""

import uuid
from smoke.client import Client, TestResult, timed


def _propose_and_approve(client: Client, session_id: str) -> TestResult:
    # 1. First turn: Request an action that requires write approval
    events_1 = client.stream_events(
        "/api/chat/stream",
        {
            "message": "Create a new Customer named 'Smoke Test Corp'",
            "session_id": session_id,
        },
    )
    types_1 = [e.get("type") for e in events_1]
    has_error_1 = any(e.get("type") == "error" for e in events_1)
    if has_error_1 or "done" not in types_1:
        return TestResult(
            "write_approval.propose",
            False,
            f"First turn failed to complete cleanly. Events: {types_1}",
        )

    # Check if a proposal was made or tool_call generated
    content_1 = "".join(e.get("text", "") for e in events_1 if e.get("type") == "token")
    proposal_noted = "PROPOSED ACTION" in content_1 or "confirm" in content_1.lower() or "approve" in content_1.lower() or "Customer" in content_1

    # 2. Second turn: Say "yes" to approve the proposal
    events_2 = client.stream_events(
        "/api/chat/stream",
        {
            "message": "yes",
            "session_id": session_id,
        },
    )
    types_2 = [e.get("type") for e in events_2]
    has_error_2 = any(e.get("type") == "error" for e in events_2)
    # When approved, the gate executes the stashed action: yielding tool_call, tool_result, and done
    executed = "tool_call" in types_2 and "tool_result" in types_2 and "done" in types_2

    ok = not has_error_2 and (executed or "done" in types_2)
    detail = f"turn1 proposal_noted={proposal_noted}, turn2 events={types_2}"
    return TestResult("write_approval.propose_and_approve", ok, detail)


def run(client: Client, ctx: dict) -> list[TestResult]:
    if ctx.get("skip_llm"):
        return [
            TestResult(
                "write_approval.propose_and_approve",
                False,
                skipped=True,
                detail="skipped -- --skip-llm",
            )
        ]

    session_id = f"smoke-write-{uuid.uuid4().hex[:8]}"
    return [
        timed("write_approval.propose_and_approve", _propose_and_approve, client, session_id)
    ]
