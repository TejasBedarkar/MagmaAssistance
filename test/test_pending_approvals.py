"""
test_pending_approvals.py
-------------------------
One turn can propose several writes (five tasks); a single "yes" must be able to run all of them,
while a re-proposal of the same action replaces the earlier one.
"""

import pytest

import db.postgres_audit_log as audit


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(audit, "DB_PATH", tmp_path / "audit.db")
    audit.init_db()
    return audit


def _task(subject):
    return {"operation": "create", "doctype": "Task", "data": {"subject": subject, "project": "PROJ-1"}}


def test_five_task_creates_are_all_kept(db):
    for i in range(5):
        db.save_pending_approval("s1", "erp_data_tool", _task(f"t{i}"))
    items = db.get_pending_approvals("s1")
    assert [i["args"]["data"]["subject"] for i in items] == [f"t{i}" for i in range(5)]


def test_same_create_revised_replaces_earlier(db):
    lead = {"operation": "create", "doctype": "Lead", "data": {"lead_name": "A"}}
    db.save_pending_approval("s1", "erp_data_tool", lead)
    db.save_pending_approval("s1", "erp_data_tool", {**lead, "data": {"lead_name": "B"}})
    items = db.get_pending_approvals("s1")
    assert len(items) == 1 and items[0]["args"]["data"]["lead_name"] == "B"


def test_updates_to_different_records_are_separate(db):
    for n in ("TASK-1", "TASK-2"):
        db.save_pending_approval("s1", "erp_data_tool", {"operation": "update", "doctype": "Task", "name": n, "data": {"status": "Open"}})
    assert len(db.get_pending_approvals("s1")) == 2


def test_clear_only_affects_its_session(db):
    db.save_pending_approval("s1", "erp_data_tool", _task("a"))
    db.save_pending_approval("s2", "erp_data_tool", _task("b"))
    db.clear_pending_approval("s1")
    assert db.get_pending_approvals("s1") == [] and len(db.get_pending_approvals("s2")) == 1
    assert db.get_pending_approval("s1") is None
