"""
test_performance_action_tools.py
--------------------------------
Draft feedback and goal tools: dry run by default, POST with the right payload, refusal
without a signed-in user, preview/result wording, and that real writes hit the approval gate.
"""

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import state
from agent import agent as agent_module
from agent.agent import _ALREADY_QUEUED, _describe_pending_action, _execute_tool, _is_write_call
from ERP.tools import performance_action_tools as pat
from ERP.tools import performance_tools as pt
from ERP.tools.performance_format import format_feedback, format_goals
from ERP_Unified.tools import ERP_UNIFIED_TOOLS

SIGNED_IN = object()
GOALS = [{"goal_name": "Close 4,00,000 in Q3 sales", "kra": "Revenue Achievement", "auto_kpi": "Sales Revenue"}]
FEEDBACK_PREVIEW = {
    "action": "create_draft", "employee": "HR-EMP-00004", "employee_name": "Neha Verma",
    "appraisal": "HR-APR-2026-00003", "appraisal_cycle": "Q2 2026-2027", "quarter": "Q2",
    "reviewer": "HR-EMP-00001", "feedback": "Neha reached 80% of her Q2 quota.",
    "criteria_to_rate": ["Communication", "Customer Handling", "Teamwork"],
}
GOALS_PREVIEW = {
    "employee": "HR-EMP-00004", "employee_name": "Neha Verma", "appraisal_cycle": "Q3 2026-2027", "quarter": "Q3",
    "start_date": "2026-10-01", "end_date": "2026-12-31", "is_sales": True,
    "goals": [
        {"goal_name": "Close 4,00,000 in Q3 sales", "kra": "Revenue Achievement", "auto_kpi": "Sales Revenue",
         "description": "", "status": "new"},
        {"goal_name": "Old goal", "kra": "Revenue Achievement", "auto_kpi": None, "description": "", "status": "already exists"},
    ],
}


def test_feedback_defaults_to_dry_run_post():
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method_post", return_value=FEEDBACK_PREVIEW) as post:
        text = pat.draft_review_feedback.func(employee="Neha", feedback="Neha reached 80% of her Q2 quota.", quarter="q2")
    post.assert_called_once_with(
        "magna_performance.api.draft_feedback",
        {"employee": "Neha", "feedback": "Neha reached 80% of her Q2 quota.", "quarter": "Q2", "dry_run": 1},
    )
    assert text.startswith("PREVIEW (nothing saved yet)")


def test_goals_real_write_sends_dry_run_zero():
    saved = dict(GOALS_PREVIEW, created=["HR-GOAL-2026-0010"])
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method_post", return_value=saved) as post:
        text = pat.set_employee_goals.func(employee="Neha", goals=GOALS, quarter="Q3", dry_run=False)
    assert post.call_args.args[1]["dry_run"] == 0 and post.call_args.args[1]["goals"] == GOALS
    assert text.startswith("SAVED: created 1 goal(s)")


def test_write_tools_refuse_without_signed_in_user():
    with patch.object(pt, "current_identity", return_value=None), \
         patch.object(pt.erp_client, "call_method_post") as post:
        result = pat.set_employee_goals.func(employee="Neha", goals=GOALS)
    assert result == pt.NO_IDENTITY
    post.assert_not_called()


def test_permission_error_on_write_does_not_leak():
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method_post", side_effect=PermissionError("denied")):
        assert pat.draft_review_feedback.func(employee="Preeti", feedback="x" * 30) == pt.NOT_ALLOWED


def test_feedback_preview_and_saved_wording():
    preview = format_feedback(FEEDBACK_PREVIEW, dry_run=True)
    assert "would create a draft feedback for Neha Verma (HR-EMP-00004)" in preview
    assert "Communication, Customer Handling, Teamwork" in preview and 'plain "yes"' in preview
    saved = format_feedback(dict(FEEDBACK_PREVIEW, name="HR-PF-2026-00010"), dry_run=False)
    assert saved.startswith("SAVED: draft feedback HR-PF-2026-00010") and "stays a draft" in saved


def test_goals_preview_marks_auto_kpi_and_skips():
    text = format_goals(GOALS_PREVIEW, dry_run=True)
    assert "Q3 (Q3 2026-2027, 2026-10-01 to 2026-12-31)" in text
    assert "Close 4,00,000 in Q3 sales (KRA Revenue Achievement, progress calculated from sales invoices)" in text
    assert "Old goal (KRA Revenue Achievement) [already exists, skipped]" in text


def test_only_real_writes_are_gated():
    for name in ("draft_review_feedback", "set_employee_goals"):
        assert _is_write_call(name, {"dry_run": False})
        assert not _is_write_call(name, {"dry_run": True})


def test_pending_action_descriptions():
    feedback = _describe_pending_action("draft_review_feedback", {"employee": "Neha", "feedback": "Good quarter.", "quarter": "Q2"})
    assert feedback == "Save draft review feedback for 'Neha' for Q2: \"Good quarter.\""
    goals = _describe_pending_action("set_employee_goals", {"employee": "Neha", "goals": GOALS, "quarter": "Q3"})
    assert goals == "Create 1 goal(s) for 'Neha' in Q3: Close 4,00,000 in Q3 sales"


@contextlib.contextmanager
def _gate(tool_result, pending=None):
    """Runs _execute_tool against a fake draft_review_feedback with the audit log mocked out."""
    fake_tool = MagicMock(args_schema=None)
    fake_tool.ainvoke = AsyncMock(return_value=tool_result)
    audit = agent_module.audit_log
    with patch.dict(state.tool_map, {"draft_review_feedback": fake_tool}), \
         patch.object(audit, "log_turn"), \
         patch.object(audit, "time_tool_call", lambda: contextlib.nullcontext(lambda: 0)), \
         patch.object(audit, "get_pending_approvals", return_value=pending or []), \
         patch.object(audit, "save_pending_approval") as save:
        yield fake_tool, save


PREVIEW_ARGS = {"employee": "Rohit Mehta", "feedback": "Rohit reached 83% of his quota this quarter."}


def test_successful_preview_is_queued_as_the_pending_write():
    with _gate("PREVIEW (nothing saved yet): would create a draft feedback ...") as (_, save):
        asyncio.run(_execute_tool("draft_review_feedback", dict(PREVIEW_ARGS), session_id="s1"))
    save.assert_called_once_with("s1", "draft_review_feedback", {**PREVIEW_ARGS, "dry_run": False})


def test_failed_preview_is_not_queued():
    with _gate("MagnaERP says: No open appraisal found for this employee.") as (_, save):
        asyncio.run(_execute_tool("draft_review_feedback", dict(PREVIEW_ARGS), session_id="s1"))
    save.assert_not_called()


def test_repeat_of_the_queued_write_returns_short_notice():
    queued = {**PREVIEW_ARGS, "dry_run": False}
    with _gate("unused", pending=[{"tool_name": "draft_review_feedback", "args": queued}]) as (tool, save):
        result = asyncio.run(_execute_tool("draft_review_feedback", dict(queued), session_id="s1"))
    assert result == _ALREADY_QUEUED
    tool.ainvoke.assert_not_called()
    save.assert_not_called()


def test_unpreviewed_write_is_turned_into_a_preview():
    unpreviewed = {**PREVIEW_ARGS, "dry_run": False}
    with _gate("PREVIEW (nothing saved yet): would create a draft feedback ...") as (tool, save):
        result = asyncio.run(_execute_tool("draft_review_feedback", dict(unpreviewed), session_id="s1"))
    assert result.startswith("PREVIEW (nothing saved yet)")
    assert tool.ainvoke.call_args.args[0]["dry_run"] is True
    save.assert_called_once_with("s1", "draft_review_feedback", unpreviewed)


def test_changed_write_is_previewed_again_not_saved():
    queued = {**PREVIEW_ARGS, "dry_run": False}
    changed = {**queued, "feedback": "Different text written after the preview."}
    with _gate("PREVIEW (nothing saved yet): ...", pending=[{"tool_name": "draft_review_feedback", "args": queued}]) as (tool, save):
        asyncio.run(_execute_tool("draft_review_feedback", changed, session_id="s1"))
    assert tool.ainvoke.call_args.args[0] == {**changed, "dry_run": True}
    save.assert_called_once_with("s1", "draft_review_feedback", changed)


def test_unpreviewed_write_with_errors_is_not_queued():
    with _gate("MagnaERP says: There is no open Q3 appraisal cycle for 2026-2027.") as (_, save):
        result = asyncio.run(_execute_tool("draft_review_feedback", {**PREVIEW_ARGS, "dry_run": False}, session_id="s1"))
    assert "no open Q3 appraisal cycle" in result
    save.assert_not_called()


def test_action_tools_are_registered():
    names = {t.name for t in ERP_UNIFIED_TOOLS}
    assert {"draft_review_feedback", "set_employee_goals"} <= names
