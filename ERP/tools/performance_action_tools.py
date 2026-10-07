"""Performance write tools: draft a manager's review feedback and set an employee's goals.

Both follow the dry-run pattern. dry_run=True returns the server-validated preview and
writes nothing; the agent then queues that exact call as the pending write, so the user's
"yes" saves what they saw. A direct dry_run=False is still intercepted by the approval gate
(_DRY_RUN_GATED_TOOLS). Access rules and validation
live in the magna_performance app, so nothing here can widen what a user may change.
"""

from typing import Any, Dict, List, Optional

from langchain_core.tools import tool

from ERP.tools.performance_format import format_feedback, format_goals
from ERP.tools.performance_tools import call_performance_api, normalize_quarter


@tool
def draft_review_feedback(
    employee: str,
    feedback: str,
    quarter: Optional[str] = None,
    dry_run: bool = True,
) -> str:
    """Save the manager's written review feedback for an employee as a DRAFT on their
    current appraisal. The manager then sets the star ratings and submits it in
    MagnaERP; this tool never submits anything.

    Before writing `feedback`, call employee_performance_summary for the same person and
    base every statement on those facts. Write it as the manager speaking to HR about the
    employee: 3 to 6 plain sentences covering results with the actual numbers (quota %,
    goal progress), one or two strengths, one or two specific things to improve, and a
    concrete focus for next quarter. Be fair and specific; no salary or CTC, no
    comparisons with colleagues, no star ratings.

    - `employee`: name as the user said it, or an exact Employee ID.
    - `quarter`: 'Q1'..'Q4' only if the user names one; otherwise the latest quarter with
      an open appraisal is used.
    - `dry_run`: leave it True. The preview is queued for the user's confirmation and their
      "yes" saves exactly that version. If you change the text, preview again. Never call
      dry_run=False in the same turn as the preview.

    Only HR or the employee's managers can do this; the result says so otherwise."""
    q, error = normalize_quarter(quarter)
    if error:
        return error
    data, error = call_performance_api(
        "draft_feedback", write=True, employee=employee, feedback=feedback, quarter=q, dry_run=1 if dry_run else 0
    )
    return error or format_feedback(data, dry_run)


@tool
def set_employee_goals(
    employee: str,
    goals: List[Dict[str, Any]],
    quarter: Optional[str] = None,
    dry_run: bool = True,
) -> str:
    """Create SMART goals for an employee in a quarter's appraisal cycle (at most 5).

    Use when the user asks to set, suggest or plan goals. To suggest good goals, first
    call employee_performance_summary to see last quarter's results, KRAs and whether the
    person is in sales. Each goal is a dict:
      - "goal_name": short, specific and measurable, e.g. "Close 4,00,000 in Q3 sales".
      - "kra": one of the KRAs on the employee's appraisal (the preview lists the allowed
        ones if you pick a wrong one).
      - "description": optional, how success is measured and by when.
      - "auto_kpi": "Sales Revenue" only for a sales employee's revenue goal, so its
        progress is calculated from invoices; leave it out otherwise.

    - `quarter`: 'Q1'..'Q4' when the user names one or says "next quarter" (work out which
      from the summary). Omit for the cycle running today. The cycle must already exist.
    - `dry_run`: leave it True. An accepted preview is queued for the user's confirmation
      and their "yes" saves exactly that version. If the preview is rejected or you change
      anything (names, KRAs, wording), preview again. Never call dry_run=False in the same
      turn as the preview.

    Goals that already exist with the same name are skipped, never duplicated. Only HR or
    the employee's managers can do this."""
    q, error = normalize_quarter(quarter)
    if error:
        return error
    data, error = call_performance_api(
        "create_goals", write=True, employee=employee, goals=goals, quarter=q, dry_run=1 if dry_run else 0
    )
    return error or format_goals(data, dry_run)


PERFORMANCE_ACTION_TOOLS = [draft_review_feedback, set_employee_goals]
