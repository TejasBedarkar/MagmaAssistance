"""
Checks: POST /api/upload-po

WARNING -- WRITE PATH: if the extracted content looks like a PO,
server.py auto-creates the Supplier/Items/Purchase Order in ERPNext
(see upload_purchase_order_file's docstring). This is NOT a read-only
check.

Because of that, this module is skipped by default. Run it explicitly
with `python smoke_test.py --include-ocr`.
"""

import json

from smoke.client import Client, TestResult, timed
from smoke import fixtures


def _upload_po(client: Client) -> TestResult:
    content = fixtures.read("sample_po.png")
    resp = client.post_multipart(
        "/api/upload-po",
        fields={"session_id": "smoke-ocr", "user_id": "smoke"},
        files={"file": ("sample_po.png", content)},
    )
    body = json.loads(resp.read())
    ok = resp.status == 200
    return TestResult("ocr.upload_po", ok, str(body)[:400])


def run(client: Client, ctx: dict) -> list[TestResult]:
    return [timed("ocr.upload_po", _upload_po, client)]
