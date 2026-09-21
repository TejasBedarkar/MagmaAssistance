"""
Checks: POST /api/upload-document

Exercises a PDF (native text), an image (Vision), a CSV (accepted) and an .exe
(rejected). Excel/Word/JSON go through the same reader (LLM/document_reader.py).
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


def _accepts_csv(client: Client) -> TestResult:
    """CSV is a supported upload type -- expects a 200 and the file read as csv."""
    fake_csv = b"item_code,item_name,qty\nITM-001,Steel Rod,10\n"
    try:
        resp = client.post_multipart(
            "/api/upload-document",
            fields={"session_id": "smoke-filereading", "user_id": "smoke"},
            files={"file": ("sample.csv", fake_csv)},
        )
        body = json.loads(resp.read())
        ok = resp.status == 200 and body.get("file_type") == "csv"
        return TestResult("file_reading.accepts_csv", ok, str(body)[:200])
    except ClientError as exc:
        return TestResult("file_reading.accepts_csv", False, str(exc))


def _rejects_unsupported_type(client: Client) -> TestResult:
    """Uploads an .exe and expects a 400 -- confirms unsupported types are still refused."""
    try:
        resp = client.post_multipart(
            "/api/upload-document",
            fields={"session_id": "smoke-filereading", "user_id": "smoke"},
            files={"file": ("sample.exe", b"MZ\x00\x00not a document")},
        )
        return TestResult(
            "file_reading.rejects_exe", False,
            f"expected 400, got {resp.status} -- unsupported type accepted?",
        )
    except ClientError as exc:
        # urllib raises HTTPError for 4xx/5xx; a 400 here is the PASS case.
        detail = str(exc)
        return TestResult("file_reading.rejects_exe", "400" in detail, detail)


def run(client: Client, ctx: dict) -> list[TestResult]:
    results = [
        timed("file_reading.sample.pdf", _upload, client, "sample.pdf"),  # native extraction, no LLM
    ]
    if ctx.get("skip_llm"):
        # sample_po.png has no native text layer -- the server falls back to
        # OpenAI Vision for it, so this one case does hit the LLM.
        results.append(TestResult("file_reading.sample_po.png", False, skipped=True, detail="skipped -- --skip-llm"))
    else:
        results.append(timed("file_reading.sample_po.png", _upload, client, "sample_po.png"))
    results.append(timed("file_reading.accepts_csv", _accepts_csv, client))
    results.append(timed("file_reading.rejects_exe", _rejects_unsupported_type, client))
    return results
