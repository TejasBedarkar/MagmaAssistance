"""
Checks: POST /api/chat, POST /query

Both are marked DEAD in ARCHITECTURE.md section 3 ("nothing in
custom_ui calls those endpoints") and are on P1's delete list.

Two modes:
  - default: reports whether they're still reachable. Expected to
    PASS (still reachable) until P1's deletion commit lands -- this is
    just a baseline record, not a judgment.
  - `--expect-deleted`: asserts they now 404/405. Run this AFTER the
    P1 commit that removes them, as your actual proof the deletion
    didn't leave a dangling route or half-removed handler.
"""

import urllib.error

from smoke.client import Client, ClientError, TestResult, timed

DEAD_ROUTES = [
    ("chat_endpoint", "/api/chat", {"message": "hi"}),
    ("query_endpoint", "/query", {"query": "hi"}),
]

GONE_STATUSES = ("404", "405")


def _check_route(client: Client, name: str, path: str, payload: dict, expect_deleted: bool) -> TestResult:
    try:
        client.post_json(path, payload)
        # request succeeded -- route is still live
        if expect_deleted:
            return TestResult(f"dead_code.{name}", False, f"{path} still reachable -- deletion not complete")
        return TestResult(f"dead_code.{name}", True, f"{path} still reachable (expected pre-deletion)")
    except ClientError as exc:
        detail = str(exc)
        is_gone = any(code in detail for code in GONE_STATUSES)
        if expect_deleted:
            return TestResult(f"dead_code.{name}", is_gone, detail)
        # pre-deletion, a 404/405 here is itself worth surfacing --
        # it means the route already doesn't exist, so no deletion work
        # is even needed for it
        return TestResult(f"dead_code.{name}", True, f"{detail} (already gone)")


def run(client: Client, ctx: dict) -> list[TestResult]:
    expect_deleted = bool(ctx.get("expect_deleted"))
    return [
        timed(f"dead_code.{name}", _check_route, client, name, path, payload, expect_deleted)
        for name, path, payload in DEAD_ROUTES
    ]
