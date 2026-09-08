"""
Checks: GET /api/health

This is the baseline check -- if this fails, nothing else in the suite
is meaningful (the server didn't come up).
"""

import json

from smoke.client import Client, TestResult, timed


def _check_health(client: Client) -> TestResult:
    resp = client.get("/api/health")
    body = json.loads(resp.read())
    ok = resp.status == 200 and body.get("status") == "ok"
    return TestResult("health.status_ok", ok, str(body))


def run(client: Client, ctx: dict) -> list[TestResult]:
    return [timed("health.status_ok", _check_health, client)]
