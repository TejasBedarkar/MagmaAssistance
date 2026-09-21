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


def test_is_write_approval_variations():
    from agent.agent import _is_write_approval

    # Direct approvals
    assert _is_write_approval("proceed")
    assert _is_write_approval("Proceed")
    assert _is_write_approval("Proceed.")
    assert _is_write_approval("Please proceed")
    assert _is_write_approval("Kindly proceed")
    assert _is_write_approval("can you proceed")
    assert _is_write_approval("you can proceed")
    assert _is_write_approval("proceed please")
    assert _is_write_approval("proceed with this")
    assert _is_write_approval("proceed with that")
    assert _is_write_approval("proceed with creation")
    assert _is_write_approval("yes proceed")
    assert _is_write_approval("Yes, please proceed")
    assert _is_write_approval("go ahead and proceed")
    assert _is_write_approval("Please confirm")
    assert _is_write_approval("Confirm and proceed")
    assert _is_write_approval("i approve")
    assert _is_write_approval("Approved")
    assert _is_write_approval("yes")
    assert _is_write_approval("sure")
    assert _is_write_approval("ok")
    assert _is_write_approval("go ahead")
    assert _is_write_approval("do it")


def test_is_write_approval_rejections_and_corrections():
    from agent.agent import _is_write_approval, _is_write_rejection

    # Negations / Rejections
    assert not _is_write_approval("do not proceed")
    assert not _is_write_approval("don't proceed")
    assert not _is_write_approval("no")
    assert not _is_write_approval("cancel")
    assert not _is_write_approval("stop")
    assert not _is_write_approval("never mind")
    assert _is_write_rejection("no")
    assert _is_write_rejection("cancel")
    assert _is_write_rejection("stop")

    # Corrections
    assert not _is_write_approval("proceed but change the name to Acme")
    assert not _is_write_approval("proceed except the email")
    assert not _is_write_approval("proceed?")


def test_prose_proposal_detection():
    from agent.agent import _PROSE_PROPOSAL_RE

    assert _PROSE_PROPOSAL_RE.search("Shall I proceed to create Customer Acme?")
    assert _PROSE_PROPOSAL_RE.search("Should I proceed with creating this lead?")
    assert _PROSE_PROPOSAL_RE.search("Would you like me to proceed?")
    assert _PROSE_PROPOSAL_RE.search("Do you want me to proceed with the conversion?")
    assert _PROSE_PROPOSAL_RE.search("Please confirm to proceed.")
    assert _PROSE_PROPOSAL_RE.search("Reply yes to approve.")

