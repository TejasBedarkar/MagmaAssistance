"""
test/smoke_test.py

End-to-end sanity check against your local Postgres (+ optionally
LocalStack for S3) before wiring this into server.py.

Run after `docker compose -f docker-compose.local.yml up -d` and
`python db/init_db.py`:

    python test/smoke_test.py
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db.postgres_audit_log as audit_log

RUN_S3_TEST = os.getenv("AWS_S3_ENDPOINT_URL") is not None or os.getenv("S3_SMOKE_TEST") == "1"


def test_audit_log():
    session_id = f"smoke-test-{uuid.uuid4().hex[:8]}"
    user_id = "test.user@example.com"

    print(f"[1] Logging a user turn for session '{session_id}' ...")
    audit_log.log_turn(session_id, "user", "What's my pending sales orders?",
                        user_id=user_id, prompt_text="What's my pending sales orders?")

    print("[2] Logging a tool call with timing ...")
    with audit_log.time_tool_call() as elapsed:
        import time
        time.sleep(0.05)  # stand-in for real tool latency
    audit_log.log_turn(
        session_id, "tool", "3 pending sales orders found.",
        tool_name="get_pending_sales_orders", tool_args={"status": "pending"},
        user_id=user_id, prompt_text="What's my pending sales orders?",
        tool_status="success", duration_ms=elapsed(),
    )

    print("[3] Logging the assistant reply ...")
    audit_log.log_turn(session_id, "assistant", "You have 3 pending sales orders.",
                        user_id=user_id, prompt_text="What's my pending sales orders?",
                        duration_ms=812)

    print("[4] Reading the transcript back ...")
    transcript = audit_log.get_transcript(session_id)
    assert len(transcript) == 3, f"expected 3 rows, got {len(transcript)}"
    tool_row = next(r for r in transcript if r["role"] == "tool")
    assert tool_row["tool_name"] == "get_pending_sales_orders"
    assert tool_row["duration_ms"] is not None and tool_row["duration_ms"] > 0
    assert tool_row["user_id"] == user_id
    print("    OK -- 3 rows, tool_name/duration_ms/user_id all recorded correctly")

    print("[5] Listing sessions ...")
    sessions = audit_log.list_sessions(limit=5)
    assert any(s["session_id"] == session_id for s in sessions)
    print(f"    OK -- session appears in list_sessions() (turn_count={[s for s in sessions if s['session_id']==session_id][0]['turn_count']})")

    return session_id


def test_s3_upload(session_id: str):
    from storage import s3_storage

    print("[6] Uploading a test file to S3 ...")
    fake_bytes = b"%PDF-1.4 fake purchase order content for smoke test"
    meta = s3_storage.upload_file(
        file_bytes=fake_bytes,
        original_filename="test_po.pdf",
        content_type="application/pdf",
        upload_kind="purchase_order",
        session_id=session_id,
        user_id="test.user@example.com",
    )
    print(f"    Uploaded to s3://{meta['s3_bucket']}/{meta['s3_key']}")

    print("[7] Recording file_uploads row ...")
    file_id = audit_log.record_file_upload(
        **meta,
        extracted_metadata={"vendor_name": "Acme Corp", "po_number": "PO-TEST-001"},
        status="processed",
    )
    print(f"    Inserted file_uploads.id = {file_id}")

    print("[8] Listing uploads for this session ...")
    uploads = audit_log.list_file_uploads(session_id=session_id)
    assert len(uploads) == 1
    assert uploads[0]["checksum_sha256"] == meta["checksum_sha256"]
    print("    OK -- checksum matches, row retrievable by session_id")

    print("[9] Generating a presigned URL ...")
    url = s3_storage.get_presigned_url(meta["s3_key"], expires_in=60)
    print(f"    {url}")


if __name__ == "__main__":
    print("=== Postgres audit log smoke test ===")
    sid = test_audit_log()
    print("\nAll Postgres checks passed.\n")

    if RUN_S3_TEST:
        print("=== S3 upload smoke test ===")
        test_s3_upload(sid)
        print("\nAll S3 checks passed.")
    else:
        print(
            "Skipping S3 test (set AWS_S3_ENDPOINT_URL for LocalStack, or "
            "S3_SMOKE_TEST=1 to run against a real S3_BUCKET_NAME)."
        )
