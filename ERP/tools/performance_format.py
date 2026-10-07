"""Plain-text renderings of magna_performance API payloads for the model to read.

Pure functions with no I/O, so the wording the model sees is easy to test.
Scores are on HRMS's 5 point scale; amounts are in company currency.
"""

from typing import Any, Dict, List, Optional

PREVIEW_INSTRUCTION = (
    "Show this preview to the user once and ask them to confirm with a plain \"yes\" or say what to change. "
    "It is already queued: their \"yes\" saves exactly this version, so don't call the tool with "
    "dry_run=False yourself."
)


def _num(value: Any, digits: int = 2) -> str:
    try:
        return f"{float(value):,.{digits}f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return "n/a"


def _money(value: Any) -> str:
    try:
        return f"{float(value):,.0f}"
    except (TypeError, ValueError):
        return "n/a"


def _goal_line(goal: Dict[str, Any]) -> str:
    source = "auto from submitted sales invoices" if goal.get("magna_auto_kpi") else "entered by the manager"
    kra = f", KRA {goal['kra']}" if goal.get("kra") else ""
    return f"    - {goal.get('goal_name')}: {_num(goal.get('progress'))}% ({source}{kra}), status {goal.get('status')}"


def _quarter_block(q: Dict[str, Any]) -> List[str]:
    lines = [f"  {q.get('quarter')} ({q.get('appraisal_cycle')}, {q.get('period')}, cycle {q.get('cycle_status')})"]
    if q.get("appraisal"):
        state = "submitted" if q.get("appraisal_submitted") else "draft, still being filled in"
        lines.append(f"    Appraisal {q['appraisal']} ({state}): final score {_num(q.get('final_score'))} / 5")
    else:
        lines.append("    No appraisal created for this quarter yet")

    sales = q.get("sales")
    if sales:
        if sales.get("quota"):
            lines.append(
                f"    Sales: {_money(sales.get('achieved'))} achieved of {_money(sales.get('quota'))} "
                f"quota ({_num(sales.get('percent'))}%)"
            )
        else:
            lines.append(f"    Sales: {_money(sales.get('achieved'))} achieved, no target set for this year")

    goals = q.get("goals") or []
    if goals:
        lines.append(f"    Goals (average progress {_num(q.get('average_goal_progress'))}%):")
        lines.extend(_goal_line(g) for g in goals)
    else:
        lines.append("    No goals set for this quarter")
    return lines


def _pip_line(pip: Dict[str, Any]) -> str:
    reviewer = f", reviewer {pip['reviewer_name']}" if pip.get("reviewer_name") else ""
    trigger = ""
    if pip.get("trigger_score") is not None:
        trigger = f", raised at score {_num(pip['trigger_score'])} vs threshold {_num(pip.get('threshold'))}"
    return (
        f"  - {pip.get('name')} for {pip.get('employee_name')}: {pip.get('status')}, "
        f"{pip.get('start_date')} to {pip.get('end_date')}{reviewer}{trigger}"
    )


def _annual_lines(annual: Optional[Dict[str, Any]]) -> List[str]:
    if not annual:
        return ["Annual appraisal: not generated yet for this year."]
    state = "submitted" if annual.get("docstatus") == 1 else "draft"
    lines = [
        f"Annual appraisal {annual.get('name')} ({state}): score {_num(annual.get('annual_score'))} / 5, "
        f"rating {annual.get('overall_rating') or 'n/a'}, improvement plans this year {annual.get('pip_count') or 0}"
    ]
    if "contribution_ratio" in annual and annual.get("is_sales"):
        lines.append(
            f"  Contribution vs cost: revenue {_money(annual.get('attributed_revenue'))} / "
            f"CTC {_money(annual.get('annual_ctc'))} = {_num(annual.get('contribution_ratio'))}"
        )
    return lines


def format_employee(data: Dict[str, Any]) -> str:
    header = (
        f"PERFORMANCE: {data.get('employee_name')} ({data.get('employee')}), "
        f"{data.get('designation') or 'no designation'}, {data.get('department') or 'no department'}, "
        f"fiscal year {data.get('fiscal_year')}"
    )
    lines = [header]
    quarters = data.get("quarters") or []
    if quarters:
        for q in quarters:
            lines.extend(_quarter_block(q))
    else:
        lines.append("  No appraisal cycles found for this fiscal year.")

    pips = data.get("open_improvement_plans") or []
    lines.append("Open improvement plans:" if pips else "Open improvement plans: none")
    lines.extend(_pip_line(p) for p in pips)
    lines.extend(_annual_lines(data.get("annual_appraisal")))
    return "\n".join(lines)


def format_team(data: Dict[str, Any]) -> str:
    rows = data.get("rows") or []
    if not rows:
        if data.get("department"):
            return f"No active employees in {data['department']} among the people you can view."
        return "No team members are visible to you for performance data."

    scope = f"department {data['department']}" if data.get("department") else "everyone you can view (all departments, not filtered)"
    lines = [
        f"TEAM PERFORMANCE: {data.get('quarter') or 'no quarter found'}, fiscal year {data.get('fiscal_year')}",
        f"Scope: {scope}",
    ]
    for row in rows:
        if row.get("final_score") is None:
            parts = ["no appraisal"]
        elif row.get("appraisal_submitted") is False:
            parts = [f"score so far {_num(row['final_score'])} / 5 (appraisal in draft, score not final, do not judge on it)"]
        else:
            parts = [f"final score {_num(row['final_score'])} / 5"]
        if row.get("average_goal_progress") is not None:
            parts.append(f"goals {_num(row['average_goal_progress'])}%")
        if row.get("sales_achievement_percent") is not None:
            parts.append(f"sales {_num(row['sales_achievement_percent'])}% of quota")
        if row.get("on_improvement_plan"):
            parts.append("ON AN IMPROVEMENT PLAN")
        lines.append(f"  - {row.get('employee_name')} ({row.get('employee')}): " + ", ".join(parts))
    return "\n".join(lines)


def format_feedback(data: Dict[str, Any], dry_run: bool) -> str:
    target = f"for {data.get('employee_name')} ({data.get('employee')}), appraisal {data.get('appraisal')}, {data.get('quarter')}"
    if dry_run:
        verb = "update the existing draft feedback" if data.get("action") == "update_draft" else "create a draft feedback"
        head = f"PREVIEW (nothing saved yet): would {verb} {target}"
    else:
        head = f"SAVED: draft feedback {data.get('name')} {target}"
    criteria = ", ".join(data.get("criteria_to_rate") or []) or "none"
    lines = [
        head,
        "Feedback text:",
        data.get("feedback") or "",
        f"Star ratings to be set by the manager in MagnaERP before submitting: {criteria}.",
    ]
    if dry_run:
        lines.append(PREVIEW_INSTRUCTION)
    else:
        lines.append("It stays a draft: the manager reviews it, sets the stars and submits it in MagnaERP.")
    return "\n".join(lines)


def format_goals(data: Dict[str, Any], dry_run: bool) -> str:
    header = "PREVIEW (nothing saved yet)" if dry_run else f"SAVED: created {len(data.get('created') or [])} goal(s)"
    lines = [
        f"{header} for {data.get('employee_name')} ({data.get('employee')}), {data.get('quarter')} "
        f"({data.get('appraisal_cycle')}, {data.get('start_date')} to {data.get('end_date')})"
    ]
    for goal in data.get("goals") or []:
        auto = ", progress calculated from sales invoices" if goal.get("auto_kpi") else ""
        exists = " [already exists, skipped]" if goal.get("status") == "already exists" else ""
        lines.append(f"  - {goal.get('goal_name')} (KRA {goal.get('kra')}{auto}){exists}")
        if goal.get("description"):
            lines.append(f"      {goal['description']}")
    if dry_run:
        lines.append(PREVIEW_INSTRUCTION)
    return "\n".join(lines)


def format_pips(pips: List[Dict[str, Any]], status: Optional[str] = None) -> str:
    if not pips:
        scope = f"with status {status}" if status else "open"
        return f"No improvement plans {scope} among the people you can view."
    title = f"IMPROVEMENT PLANS ({status})" if status else "OPEN IMPROVEMENT PLANS"
    return "\n".join([title, *(_pip_line(p) for p in pips)])
