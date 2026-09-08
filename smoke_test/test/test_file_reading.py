"""
Checks: POST /api/upload-document

Only PDF and image (jpeg/png) are exercised here because server.py's
`allowed_types` on this route is literally
["image/jpeg", "image/png", "application/pdf", "image/jpg"] --
there is no CSV/XLSX/DOCX handling anywhere in this codebase (no
pandas/openpyxl/python-docx import exists). test_rejects_unsupported_type
below exists specifically to catch it if that silently changes.
"""

import json

from smoke.client import Client, ClientError, TestResult, timed
from smoke import fixtures


def _upload(client: Client, filename: str) -> TestResult:
    content = fixtures.read(filename)
    try:
        resp = client.post_multipart(
            "/api/upload-document",
            fields={"session_id": "smoke-filereading", "user_id": "smoke"},
            files={"file": (filename, content)},
        )
    except ClientError as exc:
        # No S3 configured locally -- skip, don't fail.
        if "S3_BUCKET_NAME" in str(exc):
            return TestResult(
                f"file_reading.{filename}", False, skipped=True,
                detail="skipped -- S3 not configured (S3_BUCKET_NAME unset)",
            )
        raise
    body = json.loads(resp.read())
    ok = resp.status == 200 and bool(body.get("text") or body)
    return TestResult(f"file_reading.{filename}", ok, str(body)[:300])


def _rejects_unsupported_type(client: Client) -> TestResult:
    """Uploads a .csv and expects a 400 -- confirms the current
    "PDF/image only" behavior hasn't silently changed. A 200 here would
    mean CSV support was added and this whole module's docstring (and
    ARCHITECTURE.md's file-type assumptions) needs updating."""
    fake_csv = b"item_code,item_name,qty\nITM-001,Steel Rod,10\n"
    try:
        resp = client.post_multipart(
            "/api/upload-document",
            fields={"session_id": "smoke-filereading", "user_id": "smoke"},
            files={"file": ("sample.csv", fake_csv)},
        )
        return TestResult(
            "file_reading.rejects_csv", False,
            f"expected 400, got {resp.status} -- CSV upload now accepted?",
        )
    except ClientError as exc:
        # urllib raises HTTPError (a URLError subclass) for 4xx/5xx;
        # a 400 here is the PASS case.
        detail = str(exc)
        ok = "400" in detail
        return TestResult("file_reading.rejects_csv", ok, detail)


def run(client: Client, ctx: dict) -> list[TestResult]:
    return [
        timed("file_reading.sample.pdf", _upload, client, "sample.pdf"),
        timed("file_reading.sample_po.png", _upload, client, "sample_po.png"),
        timed("file_reading.rejects_csv", _rejects_unsupported_type, client),
    ]
