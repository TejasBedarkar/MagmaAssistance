"""
test_performance_tools.py
-------------------------
Read-only performance tools: identity guard, access errors, module detection,
parameter handling, the text the model reads, and tool/skill registration.
"""

import json
from unittest.mock import MagicMock, patch

from ERP.tools import performance_tools as pt
from ERP.tools.performance_format import format_employee, format_pips, format_team
from ERP_Unified.tools import ERP_UNIFIED_TOOLS
from skills_engine.loader import discover_skills

SIGNED_IN = object()

NEHA = {
    "employee": "HR-EMP-00004", "employee_name": "Neha Verma", "department": "Sales - MPL",
    "designation": "Sales Representative", "fiscal_year": "2026-2027",
    "quarters": [{
        "quarter": "Q2", "appraisal_cycle": "Q2 2026-2027", "period": "2026-07-01 to 2026-09-30",
        "cycle_status": "In Progress", "appraisal": "HR-APR-2026-00003", "appraisal_submitted": True,
        "final_score": 4.0, "average_goal_progress": 80.0,
        "goals": [{"goal_name": "Q2 Revenue Achievement", "kra": "Revenue Achievement", "progress": 80.0,
                   "status": "In Progress", "magna_auto_kpi": "Sales Revenue"}],
        "sales": {"sales_person": "Neha Verma", "achieved": 300000.0, "quota": 375000.0, "percent": 80.0},
    }],
    "open_improvement_plans": [],
    "annual_appraisal": None,
}


def _http_error(message):
    response = MagicMock()
    response.json.return_value = {"_server_messages": json.dumps([json.dumps({"message": message})])}
    error = Exception("417 Client Error")
    error.response = response
    return error


def _run(tool, **kwargs):
    return tool.func(**kwargs)


def test_refuses_without_signed_in_user():
    with patch.object(pt, "current_identity", return_value=None), \
         patch.object(pt.erp_client, "call_method") as call:
        result = _run(pt.employee_performance_summary, employee="Neha")
    assert result == pt.NO_IDENTITY
    call.assert_not_called()


def test_passes_only_given_params_and_skips_cache():
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method", return_value=NEHA) as call:
        _run(pt.employee_performance_summary, employee="Neha", quarter="q2")
    call.assert_called_once_with(
        "magna_performance.api.employee_performance", {"employee": "Neha", "quarter": "Q2"}, use_cache=False
    )


def test_rejects_bad_quarter_without_calling_erp():
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method") as call:
        result = _run(pt.team_performance_overview, quarter="Q5")
    assert "Q1, Q2, Q3 or Q4" in result
    call.assert_not_called()


def test_permission_error_does_not_leak_details():
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method", side_effect=PermissionError("x cannot call api")):
        result = _run(pt.employee_performance_summary, employee="Preeti")
    assert result == pt.NOT_ALLOWED and "Preeti" not in result


def test_detects_module_not_installed():
    error = Exception("Failed to get method for command magna_performance.api.pip_overview")
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method", side_effect=error):
        assert _run(pt.improvement_plan_status) == pt.NOT_INSTALLED


def test_ambiguous_name_is_relayed_from_server():
    error = _http_error("More than one employee matches <strong>Rohit</strong>: Rohit Singh (HR-EMP-00003), Rohit Mehta (HR-EMP-00005)")
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method", side_effect=error):
        result = _run(pt.employee_performance_summary, employee="Rohit")
    assert "Rohit Singh (HR-EMP-00003)" in result and "<strong>" not in result


def test_employee_text_has_the_headline_facts():
    text = format_employee(NEHA)
    assert "Neha Verma (HR-EMP-00004)" in text
    assert "final score 4 / 5" in text
    assert "300,000 achieved of 375,000 quota (80%)" in text
    assert "auto from submitted sales invoices" in text
    assert "Open improvement plans: none" in text
    assert "not generated yet" in text


def test_cost_figures_only_when_api_returns_them():
    manager_view = dict(NEHA, annual_appraisal={"name": "HR-AAP-1", "docstatus": 0, "annual_score": 4.0,
                                                "overall_rating": "Exceeds Expectations", "pip_count": 0, "is_sales": 1})
    hr_view = dict(NEHA, annual_appraisal=dict(manager_view["annual_appraisal"], attributed_revenue=300000,
                                               annual_ctc=700000, contribution_ratio=0.43))
    assert "CTC" not in format_employee(manager_view)
    assert "CTC 700,000 = 0.43" in format_employee(hr_view)


def test_team_text_flags_improvement_plans():
    team = {"fiscal_year": "2026-2027", "quarter": "Q2", "rows": [
        {"employee": "HR-EMP-00002", "employee_name": "Preeti Mishra", "final_score": 2.17,
         "average_goal_progress": 33.33, "sales_achievement_percent": 33.33, "on_improvement_plan": True},
        {"employee": "HR-EMP-00007", "employee_name": "PMS Test Rep", "final_score": None,
         "average_goal_progress": None, "sales_achievement_percent": None, "on_improvement_plan": False},
    ]}
    text = format_team(team)
    assert "Preeti Mishra (HR-EMP-00002): final score 2.17 / 5, goals 33.33%, sales 33.33% of quota, ON AN IMPROVEMENT PLAN" in text
    assert "PMS Test Rep (HR-EMP-00007): no appraisal" in text
    assert "No team members" in format_team({"rows": []})


def test_team_text_marks_draft_scores_and_scope():
    row = {"employee": "HR-EMP-00014", "employee_name": "Ananya Rao", "final_score": 2.1,
           "appraisal_submitted": False, "average_goal_progress": 70, "on_improvement_plan": False}
    unfiltered = format_team({"fiscal_year": "2026-2027", "quarter": "Q2", "rows": [row], "department": None})
    assert "appraisal in draft, score not final" in unfiltered
    assert "final score 2.1" not in unfiltered
    assert "Scope: everyone you can view (all departments, not filtered)" in unfiltered
    scoped = format_team({"fiscal_year": "2026-2027", "quarter": "Q2", "rows": [row], "department": "Sales - MPL"})
    assert "Scope: department Sales - MPL" in scoped


PREETI_PIP = {"name": "HR-PIP-2026-00003", "employee": "HR-EMP-00002", "employee_name": "Preeti Mishra",
              "status": "Draft", "start_date": "2026-09-29", "end_date": "2026-12-28",
              "reviewer_name": "Mohammad Shoaib", "trigger_score": 1.0, "threshold": 2.5}


def test_status_filter_with_no_match_still_shows_other_open_plans():
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method", side_effect=[[], [PREETI_PIP]]) as call:
        text = pt.improvement_plan_status.func(status="Active", department="Sales - MPL")
    assert "No improvement plans with status Active" in text
    assert "Other open plans (not Active):" in text and "HR-PIP-2026-00003 for Preeti Mishra: Draft" in text
    assert call.call_args_list[1].args[1] == {"department": "Sales - MPL"}


def test_status_filter_with_match_makes_one_call():
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method", return_value=[PREETI_PIP]) as call:
        text = pt.improvement_plan_status.func(status="Draft")
    assert call.call_count == 1 and "Other open plans" not in text


def test_server_message_html_entities_are_decoded():
    error = _http_error("Department <strong>R&amp;D</strong> doesn't exist. Use one of: Research &amp; Development - MPL.")
    with patch.object(pt, "current_identity", return_value=SIGNED_IN), \
         patch.object(pt.erp_client, "call_method", side_effect=error):
        result = pt.team_performance_overview.func(department="R&D")
    assert "Research & Development - MPL" in result and "&amp;" not in result


def test_empty_department_names_the_department():
    text = format_team({"fiscal_year": "2026-2027", "quarter": "Q2", "rows": [], "department": "Human Resources - MPL"})
    assert text == "No active employees in Human Resources - MPL among the people you can view."


def test_empty_pip_list_wording():
    assert format_pips([]) == "No improvement plans open among the people you can view."


def test_tools_are_registered():
    names = {t.name for t in ERP_UNIFIED_TOOLS}
    assert {"employee_performance_summary", "team_performance_overview", "improvement_plan_status"} <= names


def test_skill_is_discovered():
    skills = {s.name: s for s in discover_skills("skills")}
    assert "performance-appraisal" in skills
    assert "pip" in skills["performance-appraisal"].triggers
