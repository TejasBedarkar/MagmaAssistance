"""Read-only performance appraisal tools backed by the magna_performance Frappe app.

Each call runs as the signed-in ERP user, so the app's own access rules decide who
can be seen: HR sees everyone, anyone else only themselves and their reporting line.
With no user bound to the turn the tools refuse instead of falling back to the shared
service account, which would see everyone.
"""

import html
from typing import Any, Optional, Tuple

from langchain_core.tools import tool

from ERP.dynamic_fields import _extract_server_messages, explain_erp_error
from ERP.erp_client import current_identity, erp_client
from ERP.tools.performance_format import format_employee, format_pips, format_team

API = "magna_performance.api"
QUARTERS = {"Q1", "Q2", "Q3", "Q4"}

NO_IDENTITY = (
    "Performance data is only shared with a signed-in MagnaERP user, and this conversation isn't "
    "linked to one. Ask the user to open the assistant from inside MagnaERP while logged in."
)
NOT_ALLOWED = (
    "Not available: the user can only view or act on performance for themselves and the people who "
    "report to them (HR can view everyone). Tell the user plainly that you can't access this person's "
    "performance. Don't guess whether they exist, don't ask the user to prove they are the manager, and "
    "don't offer to draft feedback or goals for them from details the user types in."
)
NOT_INSTALLED = "The performance appraisal module isn't installed on this MagnaERP site."


def normalize_quarter(quarter: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    if not quarter:
        return None, None
    value = quarter.strip().upper()
    if value not in QUARTERS:
        return None, f"Quarter must be one of Q1, Q2, Q3 or Q4, got '{quarter}'."
    return value, None


def call_performance_api(method: str, write: bool = False, **params: Any) -> Tuple[Any, Optional[str]]:
    """(payload, None) on success, (None, message for the model) otherwise. Writes go as POST."""
    if current_identity() is None:
        return None, NO_IDENTITY

    clean = {key: value for key, value in params.items() if value not in (None, "")}
    try:
        if write:
            return erp_client.call_method_post(f"{API}.{method}", clean), None
        return erp_client.call_method(f"{API}.{method}", clean, use_cache=False), None
    except PermissionError:
        return None, NOT_ALLOWED
    except Exception as exc:  # noqa: BLE001
        messages = [html.unescape(m) for m in _extract_server_messages(exc)]
        detail = " ".join(messages) if messages else str(exc)
        if "failed to get method" in detail.lower():
            return None, NOT_INSTALLED
        if messages:
            return None, f"MagnaERP says: {detail}"
        return None, explain_erp_error(exc, context="read performance data")


@tool
def employee_performance_summary(
    employee: str,
    fiscal_year: Optional[str] = None,
    quarter: Optional[str] = None,
) -> str:
    """Performance of ONE employee: quarterly appraisal scores, goals and their
    progress, sales achieved vs quota (for sales staff), open improvement plans
    (PIPs) and the annual appraisal rating.

    Use for questions like "how is Neha doing this quarter", "show Rohit's
    appraisal", "what is Preeti's final score / rating", "is Amit hitting his
    target". Read-only.

    - `employee`: the person's name as the user said it (partial is fine) or an
      exact Employee ID like 'HR-EMP-00004'. Never invent an ID.
    - `fiscal_year`: e.g. '2026-2027'. Omit for the current fiscal year.
    - `quarter`: only when the user names one ('Q1'..'Q4'). For "this quarter",
      "now" or no mention, omit it: the result covers every quarter of the year
      and you can pick the latest one that has data.

    Results are limited to people the signed-in user may see. If several people
    match the name, the result lists them; ask the user which one they meant."""
    q, error = normalize_quarter(quarter)
    if error:
        return error
    data, error = call_performance_api("employee_performance", employee=employee, fiscal_year=fiscal_year, quarter=q)
    return error or format_employee(data)


@tool
def team_performance_overview(
    department: Optional[str] = None,
    fiscal_year: Optional[str] = None,
    quarter: Optional[str] = None,
) -> str:
    """One line per team member for a quarter: final appraisal score, average
    goal progress, sales achievement % and whether they are on an improvement
    plan. Pass `quarter` ('Q1'..'Q4') only when the user names one; for "this
    quarter", "now" or no mention, omit it and the tool picks the latest
    quarter that has started.

    Use for "how is my team doing", "who is below target", "rank my sales team",
    "who needs attention this quarter". Managers see their reporting line (not
    themselves); HR sees everyone. Whenever the user names a team or department
    ("sales team", "R&D", "HR"), pass it as `department` (short names like 'Sales'
    work). Describe results only by the Scope line the tool returns: never call
    an unfiltered result "the sales team" or any other department. Read-only."""
    q, error = normalize_quarter(quarter)
    if error:
        return error
    data, error = call_performance_api("team_performance", department=department, fiscal_year=fiscal_year, quarter=q)
    return error or format_team(data)


@tool
def improvement_plan_status(status: Optional[str] = None, department: Optional[str] = None) -> str:
    """Performance Improvement Plans (PIPs) for the people the user may see.

    Leave `status` empty for "who is on a PIP", "any improvement plans" and
    similar: that returns every open plan (Draft, Active and Extended). Pass a
    `status` ('Draft', 'Active', 'Extended', 'Completed', 'Failed' or
    'Cancelled') only when the user asks for that specific state, e.g. "plans
    pending HR review" = 'Draft', "completed PIPs" = 'Completed'. Read-only:
    starting or closing a plan is done by HR in MagnaERP."""
    data, error = call_performance_api("pip_overview", status=status, department=department)
    if error:
        return error
    text = format_pips(data, status)
    if status and not data:
        # The model sometimes narrows "who is on a PIP" to one status, so surface the other open plans too.
        others, error = call_performance_api("pip_overview", department=department)
        if not error and others:
            text += f"\nOther open plans (not {status}):\n" + "\n".join(format_pips(others).splitlines()[1:])
    return text


PERFORMANCE_TOOLS = [employee_performance_summary, team_performance_overview, improvement_plan_status]
