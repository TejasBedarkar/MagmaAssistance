"""
ERP/tools/manufacturing_reports_tools.py

Report-running tools for the Manufacturing module's "Reports" section.
Unlike manufacturing_read_tools.py (which lists/looks-up individual
doctype records via ERPNext's default REST API), these tools run
ERPNext's named Frappe reports (Query Report / Script Report) through
the framework's standard report-execution endpoint:

    GET /api/method/frappe.desk.query_report.run
        ?report_name=<Report Name>&filters=<json>

This is the same mechanism the ERPNext desk UI uses under the hood when
you open a report and apply filters — it works for any report already
defined on the site (standard or custom) without needing a bespoke
whitelisted method per report, unlike the sales_app.api.* endpoints
documented for the Sales module.

THIS FILE COVERS ALL 10 OF THE PROJECT'S REPORT SEGMENTS:
    1. Production Planning Report
    2. Material Requirements Planning
    3. Work Order Summary
    4. Quality Inspection Summary
    5. Downtime Analysis
    6. Job Card Summary
    7. BOM Search
    8. Production Analysis
    9. BOM Operation Time
    10. Work Order Consumed Materials

If an 11th segment ever gets added, copy one of the @tool functions
below as a template, adjust REPORT_NAMES + the filter set, and append
to MANUFACTURING_REPORTS_TOOLS at the bottom.

IMPORTANT — verify field names against your actual report filters:
Every Frappe report defines its own filter fieldnames in its report
script (e.g. reports/production_planning_report/production_planning_report.js).
The fieldnames used below (company, from_date, to_date, status, ...) are
ERPNext's usual conventions, but if your site's report scripts use
different fieldnames, you only need to change two places, both grouped
at the top of this file for convenience:
    - REPORT_NAMES: the exact `report_name` string ERPNext knows the
      report by (must match the Report doctype's `name` field exactly,
      case-sensitive).
    - Each tool's `filters = {...}` dict: the keys are the filter
      fieldnames sent to the report.

FILTER-FLOW BEHAVIOUR (how this is meant to be used from chat):
  - Fields marked required below are wired into REQUIRED_FIELDS so
    ERP/server.py's slot-filling flow asks for them if the user's
    request doesn't already supply them.
  - Every other filter is optional: pass it if the user mentioned it,
    otherwise leave it out and the tool applies the same default the
    report's filter panel would (a date range, "All", etc.) — see each
    tool's docstring for its default.
  - Fields that accept multiple values (e.g. several Sales Order IDs)
    are typed as Optional[List[str]] — pass a list; free-text
    slot-filling answers for these are split on commas/semicolons via
    _parse_id_list_answer() in FIELD_PARSERS below.
  - Output is a markdown table (so the chat UI renders it as a real
    table) followed by a short **Summary** line with row counts and,
    where relevant, totals/status breakdowns — this is what feeds the
    LLM enough structure to explain the results in plain language on
    top of the raw table, per the "interpret the data in simple words"
    requirement.

Add this list to ERP/tools/__init__.py:
    from .manufacturing_reports_tools import MANUFACTURING_REPORTS_TOOLS
    ALL_TOOLS = [..., *MANUFACTURING_REPORTS_TOOLS]
"""

import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional

import requests
from langchain_core.tools import tool

from ERP.erp_client import erp_client

logger = logging.getLogger("manufacturing-reports-tools")

# ---------------------------------------------------------------------
# Report name registry — the exact Report doctype `name` on the ERPNext
# site. Edit here if your site's report is named differently.
# ---------------------------------------------------------------------
REPORT_NAMES = {
    "production_planning": "Production Planning Report",
    "mrp": "Material Requirements Planning Report",
    "work_order_summary": "Work Order Summary",
    "quality_inspection_summary": "Quality Inspection Summary",
    "downtime_analysis": "Downtime Analysis",
    "job_card_summary": "Job Card Summary",
    # NOT VERIFIED — no report named "BOM Search" exists on this site
    # (confirmed via test_find_production_report.py's Manufacturing
    # module listing). Nothing else in that listing looks like a real
    # match either ("BOM Explorer" browses a BOM's own structure
    # forward, not "which finished item uses these raw materials"
    # reverse-lookup). See the note above get_bom_search_report() below
    # before relying on this one.
    "bom_search": "BOM Search",
    "production_analysis": "Production Analytics",
    "bom_operation_time": "BOM Operations Time",
    "work_order_consumed_materials": "Work Order Consumed Materials",
}


# ---------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------

def _safe_call(label, fn):
    """Same convention as manufacturing_read_tools.py: never raises —
    failures are caught and turned into a short string the LLM can
    relay honestly instead of crashing the turn. The full traceback is
    logged (not shown to the user) so issues can be diagnosed directly
    from the server log instead of guessing from the short message."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to %s", label)
        return f"Could not {label} right now ({exc})."


def _today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _now_datetime_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _days_ago_str(days: int) -> str:
    return (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")


def _days_ago_datetime_str(days: int) -> str:
    return (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def _months_ago_str(months: int) -> str:
    return _days_ago_str(30 * months)


def _years_ago_str(years: int) -> str:
    return _days_ago_str(365 * years)


def _current_fiscal_year_str() -> str:
    """Returns the current fiscal year as 'YYYY-YYYY' assuming an
    April-to-March fiscal year (matches the stated default of
    '2026-2027' for a date in mid-2026). If your site's fiscal year
    doesn't start in April, adjust the month check below."""
    now = datetime.now()
    start_year = now.year if now.month >= 4 else now.year - 1
    return f"{start_year}-{start_year + 1}"


def _run_report(report_name: str, filters: dict) -> dict:
    """Runs a named Frappe report with the given filters and normalizes
    the response to a dict with 'result' and 'columns' keys.

    Most Script/Query reports return {"result": [...], "columns": [...]}
    under `message`, but some report types (Report Builder reports, or
    certain older Query Reports) return `message` as a bare list of rows
    instead. Normalizing here means _format_report_table() never has to
    guess the shape, and callers never crash on a report that happens to
    be configured differently on a given site."""
    payload = None
    try:
        payload = erp_client.call_method(
            "frappe.desk.query_report.run",
            params={"report_name": report_name, "filters": json.dumps(filters)},
        )
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status == 404:
            raise ValueError(
                f"Report '{report_name}' was not found on this ERPNext site (404 — "
                "wrong report name, not a filter problem). Open the report in the "
                "ERPNext desk (Manufacturing workspace, or search its name in the "
                "awesomebar) to get its exact name, then fix the matching entry in "
                "REPORT_NAMES at the top of manufacturing_reports_tools.py."
            ) from exc
        raise

    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list):
        return {"result": payload, "columns": None}
    return {"result": [], "columns": None}


def _column_label(col) -> str:
    if isinstance(col, dict):
        return col.get("label") or col.get("fieldname") or "?"
    if isinstance(col, str):
        # Frappe sometimes encodes columns as "fieldname:Type/Options:width"
        return col.split(":")[0]
    return str(col)


def _column_fieldname(col):
    if isinstance(col, dict):
        return col.get("fieldname")
    if isinstance(col, str):
        return col.split(":")[0]
    return None


def _rows_as_dicts(columns, result) -> list:
    """Query reports can return rows either as a list of dicts (most
    Script Reports) or a list of plain lists positionally matching
    `columns` (classic Query Reports) — normalize to dicts either way.

    Some reports mix the two within the same `result` (e.g. data rows as
    dicts plus an appended "Total" row as a plain list), so each row is
    normalized independently rather than assuming the whole list matches
    whatever shape the first row happens to be.

    If `columns` is missing/shorter than a row (e.g. the report gave no
    column metadata at all, per _run_report's fallback), generic
    'col_1', 'col_2', ... names are used instead of silently dropping
    data via a short zip()."""
    if not result:
        return []

    fieldnames = [_column_fieldname(c) for c in (columns or [])]

    normalized = []
    for row in result:
        if isinstance(row, dict):
            normalized.append(row)
            continue
        if isinstance(row, (list, tuple)):
            row_fieldnames = fieldnames if len(fieldnames) >= len(row) else [
                f"col_{i + 1}" for i in range(len(row))
            ]
            normalized.append(dict(zip(row_fieldnames, row)))
            continue
        # Anything else unexpected (None, a bare string, ...) — keep it
        # visible in the table rather than dropping the row silently.
        normalized.append({"value": row})

    return normalized


def _format_report_table(columns, result, empty_message: str, max_rows: int = 100) -> str:
    """Turns a query_report.run response into a markdown table plus a
    short **Summary** line (row count, obvious numeric totals, and a
    status-style breakdown if the report has one) — enough structure for
    the LLM to explain the results in plain words on top of the table."""
    rows = _rows_as_dicts(columns, result)
    if not rows:
        return empty_message

    if columns:
        labels = [_column_label(c) for c in columns]
        fieldnames = [_column_fieldname(c) for c in columns]
    else:
        # No column metadata came back — fall back to the keys of the
        # first row (still fine since _rows_as_dicts already normalized).
        fieldnames = list(rows[0].keys())
        labels = fieldnames

    shown = rows[:max_rows]
    header = "| " + " | ".join(labels) + " |"
    divider = "| " + " | ".join("---" for _ in labels) + " |"
    lines = [header, divider]
    for row in shown:
        cells = []
        for fn in fieldnames:
            value = row.get(fn)
            cells.append("" if value in (None, "") else str(value))
        lines.append("| " + " | ".join(cells) + " |")
    table_md = "\n".join(lines)

    summary_bits = [f"{len(rows)} row(s) returned"]
    if len(rows) > max_rows:
        summary_bits.append(f"showing first {max_rows}")

    # Generic numeric totals for columns that look like amount/qty/value/total fields.
    numeric_totals = {}
    for fn, label in zip(fieldnames, labels):
        if not fn or not any(k in fn.lower() for k in ("amount", "qty", "value", "total", "duration")):
            continue
        total, count = 0, 0
        for row in rows:
            v = row.get(fn)
            if isinstance(v, (int, float)):
                total += v
                count += 1
        if count:
            numeric_totals[label] = total
    if numeric_totals:
        totals_str = ", ".join(f"{label}: {total:,.2f}" for label, total in numeric_totals.items())
        summary_bits.append(f"totals -> {totals_str}")

    # First status-like column gets a value breakdown (e.g. how many rows per status).
    for fn, label in zip(fieldnames, labels):
        if not fn or "status" not in fn.lower():
            continue
        counts = {}
        for row in rows:
            v = row.get(fn)
            if v:
                counts[v] = counts.get(v, 0) + 1
        if counts:
            breakdown = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1]))
            summary_bits.append(f"{label} breakdown -> {breakdown}")
        break

    summary = "; ".join(summary_bits)
    return f"{table_md}\n\n**Summary:** {summary}"


def _parse_id_list_answer(text: str) -> list:
    """Parses a free-text slot-filling answer like 'SO-00001, SO-00002' or
    'SO-00001; SO-00002' into a list of IDs — used for filters that take
    multiple values (e.g. sales_order_ids)."""
    if not text:
        return []
    parts = [p.strip() for p in text.replace(";", ",").split(",")]
    return [p for p in parts if p]


# ---------------------------------------------------------------------
# 1. Production Planning Report
# ---------------------------------------------------------------------

@tool
def get_production_planning_report(
    company: str,
    based_on: Optional[str] = "Sales Order",
    sales_order_ids: Optional[List[str]] = None,
    raw_material_warehouse: Optional[str] = None,
    order_by: Optional[str] = "Delivery Date",
):
    """Runs the Production Planning Report — what needs to be produced
    (and its raw material position), sourced from Sales Orders, Material
    Requests, or Work Orders. `company` is required.

    - `based_on`: source driving the plan — 'Sales Order' (default),
      'Material Request', or 'Work Order'.
    - `sales_order_ids`: optional list of specific Sales Order IDs to
      narrow to (relevant when `based_on` is 'Sales Order'); leave blank
      to include all.
    - `raw_material_warehouse`: optional warehouse to check raw material
      availability against.
    - `order_by`: how rows are sorted — 'Delivery Date' (default) or
      'Total Amount'.

    Use for requests like 'run the production planning report for Acme
    Corp' or 'production plan based on SO-00001 and SO-00002'. Returns a
    markdown table plus a short summary — leave any filter unmentioned
    to use its default."""

    def run():
        filters = {"company": company}
        if based_on:
            filters["based_on"] = based_on
        if sales_order_ids:
            filters["sales_order"] = sales_order_ids
        if raw_material_warehouse:
            filters["raw_material_warehouse"] = raw_material_warehouse
        if order_by:
            filters["order_by"] = order_by

        data = _run_report(REPORT_NAMES["production_planning"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No production planning data found for those filters.",
        )

    return _safe_call("run the production planning report", run)


# ---------------------------------------------------------------------
# 2. Material Requirements Planning
# ---------------------------------------------------------------------

@tool
def get_material_requirements_planning_report(
    company: str,
    warehouse: str,
    mps_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    item_code: Optional[str] = None,
    material_type: Optional[str] = "All",
):
    """Runs the Material Requirements Planning (MRP) report — raw
    material / finished goods requirements against a Master Production
    Schedule. `company`, `warehouse`, and `mps_id` (the Master
    Production Schedule ID, e.g. 'MPS-00001') are all required.

    - `from_date`/`to_date`: defaults to the last 2 months if not given.
    - `item_code`: optional, narrows to a single item.
    - `material_type`: 'All' (default), 'Finished Goods', or 'Raw
      Material'.

    Use for requests like 'run MRP for the Main Warehouse against
    MPS-00001'. Returns a markdown table plus a short summary."""

    def run():
        resolved_from = from_date or _months_ago_str(2)
        resolved_to = to_date or _today_str()
        filters = {
            "company": company,
            "warehouse": warehouse,
            "mps_id": mps_id,
            "from_date": resolved_from,
            "to_date": resolved_to,
            "material_type": material_type or "All",
        }
        if item_code:
            filters["item_code"] = item_code

        data = _run_report(REPORT_NAMES["mrp"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No MRP data found for those filters.",
        )

    return _safe_call("run the material requirements planning report", run)


# ---------------------------------------------------------------------
# 3. Work Order Summary
# ---------------------------------------------------------------------

@tool
def get_work_order_summary_report(
    company: str,
    date_basis: Optional[str] = "Creation Date",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    status: Optional[str] = None,
    sales_order_ids: Optional[List[str]] = None,
    production_item_code: Optional[str] = None,
    age: Optional[int] = None,
):
    """Runs the Work Order Summary report. `company` is required.

    - `date_basis`: which date field `from_date`/`to_date` apply to —
      'Creation Date' (default), 'Planned Date', or 'Actual Date'.
    - `from_date`/`to_date`: defaults to the last 3 months if not given.
    - `status`: one of 'Not Started', 'In Process', 'Completed',
      'Stopped', 'Closed'.
    - `sales_order_ids`: optional list of Sales Order IDs to narrow to.
    - `production_item_code`: optional Item code being manufactured.
    - `age`: optional, filters to work orders at least this many days old.

    Use for requests like 'show me the work order summary for this
    quarter' or 'which work orders for SO-00001 are still in process?'.
    Returns a markdown table plus a short summary."""

    def run():
        resolved_from = from_date or _months_ago_str(3)
        resolved_to = to_date or _today_str()
        filters = {
            "company": company,
            "date_basis": date_basis or "Creation Date",
            "from_date": resolved_from,
            "to_date": resolved_to,
        }
        if status:
            filters["status"] = status
        if sales_order_ids:
            filters["sales_order"] = sales_order_ids
        if production_item_code:
            filters["production_item"] = production_item_code
        if age is not None:
            filters["age"] = age

        data = _run_report(REPORT_NAMES["work_order_summary"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No work orders found for those filters.",
        )

    return _safe_call("run the work order summary report", run)


# ---------------------------------------------------------------------
# 4. Quality Inspection Summary
# ---------------------------------------------------------------------

@tool
def get_quality_inspection_summary_report(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    status: Optional[str] = None,
    item_code: Optional[str] = None,
    inspected_by: Optional[str] = None,
):
    """Runs the Quality Inspection Summary report. No filters are
    required — running it with nothing set returns the last 1 year.

    - `from_date`/`to_date`: defaults to the last 1 year if not given.
    - `status`: 'Accepted' or 'Rejected'.
    - `item_code`: optional Item code.
    - `inspected_by`: optional inspector, as an Employee email ID.

    Use for requests like 'show me rejected inspections this year' or
    'what has jane@company.com inspected?'. Returns a markdown table plus
    a short summary."""

    def run():
        resolved_from = from_date or _years_ago_str(1)
        resolved_to = to_date or _today_str()
        filters = {"from_date": resolved_from, "to_date": resolved_to}
        if status:
            filters["status"] = status
        if item_code:
            filters["item_code"] = item_code
        if inspected_by:
            filters["inspected_by"] = inspected_by

        data = _run_report(REPORT_NAMES["quality_inspection_summary"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No quality inspections found for those filters.",
        )

    return _safe_call("run the quality inspection summary report", run)


# ---------------------------------------------------------------------
# 5. Downtime Analysis
# ---------------------------------------------------------------------

@tool
def get_downtime_analysis_report(
    from_datetime: Optional[str] = None,
    to_datetime: Optional[str] = None,
    workstation: Optional[str] = None,
):
    """Runs the Downtime Analysis report (machine/workstation downtime
    over a date-time range). No filters are required — running it with
    nothing set returns the last 1 month.

    - `from_datetime`/`to_datetime`: 'YYYY-MM-DD HH:MM:SS' format,
      defaults to the last 1 month if not given.
    - `workstation`: optional workstation/machine name.

    Use for requests like 'show me downtime on the CNC machine last
    week' or 'downtime analysis for the past month'. Returns a markdown
    table plus a short summary."""

    def run():
        resolved_from = from_datetime or _days_ago_datetime_str(30)
        resolved_to = to_datetime or _now_datetime_str()
        filters = {"from_date": resolved_from, "to_date": resolved_to}
        if workstation:
            filters["workstation"] = workstation

        data = _run_report(REPORT_NAMES["downtime_analysis"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No downtime entries found for those filters.",
        )

    return _safe_call("run the downtime analysis report", run)


# ---------------------------------------------------------------------
# 6. Job Card Summary
# ---------------------------------------------------------------------

@tool
def get_job_card_summary_report(
    company: str,
    fiscal_year: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    status: Optional[str] = None,
    work_order_id: Optional[str] = None,
    production_item_code: Optional[str] = None,
    workstation: Optional[str] = None,
    operation: Optional[str] = None,
):
    """Runs the Job Card Summary report. `company` is required.

    - `fiscal_year`: defaults to the current fiscal year (e.g.
      '2026-2027') if not given.
    - `from_date`/`to_date`: defaults to the last 3 months if not given
      (some reports treat a missing date range as "match nothing" rather
      than "no date filter", so a real default is always sent).
    - `status`: one of 'Open', 'Work In Progress', 'Completed', 'On
      Hold'.
    - `work_order_id`: optional Work Order ID to narrow to.
    - `production_item_code`: optional Item code being manufactured.
    - `workstation`: optional workstation/machine name.
    - `operation`: optional operation name (e.g. 'Cutting', 'Assembly').

    Use for requests like 'show me the job card summary for this fiscal
    year' or 'job cards on the CNC-01 workstation that are still in
    progress'. Returns a markdown table plus a short summary."""

    def run():
        filters = {
            "company": company,
            "fiscal_year": fiscal_year or _current_fiscal_year_str(),
            "from_date": from_date or _months_ago_str(3),
            "to_date": to_date or _today_str(),
        }
        if status:
            filters["status"] = status
        if work_order_id:
            filters["work_order"] = work_order_id
        if production_item_code:
            filters["production_item"] = production_item_code
        if workstation:
            filters["workstation"] = workstation
        if operation:
            filters["operation"] = operation

        data = _run_report(REPORT_NAMES["job_card_summary"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No job cards found for those filters.",
        )

    return _safe_call("run the job card summary report", run)


# ---------------------------------------------------------------------
# 7. BOM Search
# ---------------------------------------------------------------------

MAX_BOM_SEARCH_ITEMS = 5


@tool
def get_bom_search_report(component_item_codes: List[str]):
    """Runs the BOM Search report — given up to 5 component/raw material
    Item codes, finds the finished-good Item(s) / BOM(s) that use them
    (i.e. "what can be manufactured from these components?"). At least
    one item code is required; only the first 5 are used if more are
    given.

    ⚠ UNVERIFIED: no report named 'BOM Search' was found via
    test_find_production_report.py's listing of this site's
    Manufacturing-module reports — this will likely 404 until
    REPORT_NAMES["bom_search"] is corrected. See the comment above that
    entry for what to check next.

    Use for requests like 'what can be made from RM-001 and RM-002?' or
    'find the BOM that uses ITEM-RAW-01, ITEM-RAW-02, ITEM-RAW-03'.
    Returns a markdown table plus a short summary."""

    def run():
        items = [i for i in (component_item_codes or []) if i][:MAX_BOM_SEARCH_ITEMS]
        if not items:
            return "Please give at least one component item code to search by."

        filters = {f"item_{i + 1}": item for i, item in enumerate(items)}

        data = _run_report(REPORT_NAMES["bom_search"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No BOM/finished item found using those components.",
        )

    return _safe_call("run the BOM search report", run)


# ---------------------------------------------------------------------
# 8. Production Analysis
# ---------------------------------------------------------------------

@tool
def get_production_analysis_report(
    company: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    range_type: Optional[str] = "Monthly",
):
    """Runs the Production Analysis report. `company` is required.

    - `from_date`/`to_date`: defaults to the last 1 year if not given.
    - `range_type`: how results are bucketed — 'Weekly', 'Monthly'
      (default), 'Quarterly', or 'Yearly'.

    Use for requests like 'show me production analysis for this year, by
    quarter' or 'monthly production analysis for Acme Corp'. Returns a
    markdown table plus a short summary."""

    def run():
        resolved_from = from_date or _years_ago_str(1)
        resolved_to = to_date or _today_str()
        filters = {
            "company": company,
            "from_date": resolved_from,
            "to_date": resolved_to,
            "range": range_type or "Monthly",
        }

        data = _run_report(REPORT_NAMES["production_analysis"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No production analysis data found for those filters.",
        )

    return _safe_call("run the production analysis report", run)


# ---------------------------------------------------------------------
# 9. BOM Operation Time
# ---------------------------------------------------------------------

@tool
def get_bom_operation_time_report(
    item_code: Optional[str] = None,
    bom_id: Optional[str] = None,
    workstation: Optional[str] = None,
):
    """Runs the BOM Operation Time report — operation-wise time estimates
    from a BOM's routing. No filters are required; running it with
    nothing set returns all operations.

    - `item_code`: optional Item code to narrow to.
    - `bom_id`: optional BOM ID (e.g. 'BOM-ITEM-001-001').
    - `workstation`: optional workstation/machine name.

    Use for requests like 'how long do operations on BOM-ITEM-001-001
    take?' or 'operation times for the CNC-01 workstation'. Returns a
    markdown table plus a short summary."""

    def run():
        filters = {}
        if item_code:
            filters["item_code"] = item_code
        if bom_id:
            filters["bom_id"] = bom_id
        if workstation:
            filters["workstation"] = workstation

        data = _run_report(REPORT_NAMES["bom_operation_time"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No BOM operation time data found for those filters.",
        )

    return _safe_call("run the BOM operation time report", run)


# ---------------------------------------------------------------------
# 10. Work Order Consumed Materials
# ---------------------------------------------------------------------

@tool
def get_work_order_consumed_materials_report(
    company: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    work_order: Optional[str] = None,
    production_item_code: Optional[str] = None,
    status: Optional[str] = None,
):
    """Runs the Work Order Consumed Materials report — actual raw
    material consumption against Work Orders. `company` is required.

    - `from_date`/`to_date`: defaults to the last 1 month if not given.
    - `work_order`: optional Work Order ID to narrow to.
    - `production_item_code`: optional Item code being manufactured.
    - `status`: one of 'In Process', 'Completed', 'Stopped'.

    Use for requests like 'what materials were consumed on WO-00001?' or
    'show me consumed materials for completed work orders this month'.
    Returns a markdown table plus a short summary."""

    def run():
        resolved_from = from_date or _months_ago_str(1)
        resolved_to = to_date or _today_str()
        filters = {
            "company": company,
            "from_date": resolved_from,
            "to_date": resolved_to,
        }
        if work_order:
            filters["work_order"] = work_order
        if production_item_code:
            filters["production_item"] = production_item_code
        if status:
            filters["status"] = status

        data = _run_report(REPORT_NAMES["work_order_consumed_materials"], filters)
        return _format_report_table(
            data.get("columns"),
            data.get("result"),
            "No consumed material data found for those filters.",
        )

    return _safe_call("run the work order consumed materials report", run)


# ---------------------------------------------------------------------
# Diagnostic: look up a report's exact name
# ---------------------------------------------------------------------

@tool
def find_erp_report_by_name(search_term: str):
    """Looks up Report names on this ERPNext site that contain
    `search_term` (case-insensitive partial match). Use this whenever
    one of the report tools above fails with a 'not found (404)' error
    — it means the name hardcoded in REPORT_NAMES doesn't match this
    site exactly, and this tool finds the real one. Also useful for a
    user asking something like 'what reports exist for production?'.

    Returns a markdown table of matching report names with their type
    and module."""

    def run():
        matches = erp_client.get_list(
            "Report",
            fields=["name", "report_type", "module", "is_standard"],
            filters=[["name", "like", f"%{search_term}%"]],
            limit=20,
        )
        return _format_report_table(
            None,
            matches,
            f"No reports found on this site matching '{search_term}'.",
        )

    return _safe_call(f"look up reports matching '{search_term}'", run)


MANUFACTURING_REPORTS_TOOLS = [
    get_production_planning_report,
    get_material_requirements_planning_report,
    get_work_order_summary_report,
    get_quality_inspection_summary_report,
    get_downtime_analysis_report,
    get_job_card_summary_report,
    get_bom_search_report,
    get_production_analysis_report,
    get_bom_operation_time_report,
    get_work_order_consumed_materials_report,
    find_erp_report_by_name,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
# Only the fields the user explicitly marked "required" go here. Every
# other filter is optional and simply falls back to its documented
# default (a dropdown default, or a date range) when omitted.
REQUIRED_FIELDS = {
    "get_production_planning_report": [
        ("company", "Which company should I run the Production Planning Report for?"),
    ],
    "get_material_requirements_planning_report": [
        ("company", "Which company is this MRP report for?"),
        ("warehouse", "Which warehouse should the MRP report check?"),
        ("mps_id", "Which Master Production Schedule (MPS) ID should this run against?"),
    ],
    "get_work_order_summary_report": [
        ("company", "Which company should I run the Work Order Summary for?"),
    ],
    "get_job_card_summary_report": [
        ("company", "Which company should I run the Job Card Summary for?"),
    ],
    "get_bom_search_report": [
        (
            "component_item_codes",
            "Which component/raw material item codes should I search by? "
            "(up to 5, comma-separated)",
        ),
    ],
    "get_production_analysis_report": [
        ("company", "Which company should I run the Production Analysis for?"),
    ],
    "get_work_order_consumed_materials_report": [
        ("company", "Which company should I run the Work Order Consumed Materials report for?"),
    ],
    "find_erp_report_by_name": [
        ("search_term", "What should I search the report names for? e.g. 'Production' or 'Downtime'."),
    ],
    # Quality Inspection Summary, Downtime Analysis, and BOM Operation Time
    # have no required fields, so they're deliberately absent here.
}

# Free-text slot-filling answers for list-typed filters need splitting
# into a list before being passed to the tool.
FIELD_PARSERS = {
    ("get_production_planning_report", "sales_order_ids"): _parse_id_list_answer,
    ("get_work_order_summary_report", "sales_order_ids"): _parse_id_list_answer,
    ("get_bom_search_report", "component_item_codes"): _parse_id_list_answer,
}