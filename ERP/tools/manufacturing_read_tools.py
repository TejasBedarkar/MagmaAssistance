"""
ERP/tools/manufacturing_read_tools.py

Look-up/list tools for the Manufacturing module, on ERPNext's DEFAULT
REST API (GET /api/resource/<Doctype>) via erp_client.get_list() /
get_doc(). Pairs with manufacturing_write_tools.py's create_/update_
tools for the same doctypes (Work Order, Production Plan, Job Card,
Stock Entry, Bin).

NOTE ON PROJECT CONVENTIONS: none of the existing domain modules
(sales_write_tools.py, inventory_write_tools.py, etc.) have a read-side
counterpart yet — they're write-only. This module establishes the
read-side pattern for the project; the same shape (get_<doc>/list_<docs>
using erp_client.get_list()/get_doc(), _format_records() for readable
output, _safe_call() for error handling) can be copied to build
sales_read_tools.py / inventory_read_tools.py / etc. later.

Field mapping notes (stock ERPNext v16 fieldnames — same doctypes as
manufacturing_write_tools.py; see that file's docstring for the fuller
per-doctype notes):

  Work Order     name, production_item, qty, produced_qty, status,
                 planned_start_date, wip_warehouse, fg_warehouse
  Production Plan name, posting_date, status, docstatus
  Job Card       name, work_order, operation, workstation, status,
                 for_quantity
  Stock Entry    name, stock_entry_type, work_order, posting_date,
                 docstatus (filtered to work-order-linked entries here,
                 since general stock movements are inventory_write_tools'
                 territory)
  Bin            item_code, warehouse, actual_qty, reserved_qty,
                 projected_qty — ERPNext's live stock-balance doctype
                 (one row per item+warehouse combination), used here for
                 "how much of X do we have" style questions.

Same conventions as the write-tools modules:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — failures are caught and turned into a short string the
    LLM can relay honestly.
  - optional args are typed Optional[...] = None and only added to the
    filter list when actually given, so an unfiltered list_* call just
    returns the most recent records instead of an empty result.
  - erp_client caches GETs for a short TTL by default (see
    DEFAULT_CACHE_TTL_SECONDS in erp_client.py), so rapid repeat lookups
    (e.g. the LLM checking the same Work Order twice in one turn) don't
    re-hit ERPNext every time.

Add this list to ERP/tools/__init__.py:
    from .manufacturing_read_tools import MANUFACTURING_READ_TOOLS
    ALL_TOOLS = [..., *MANUFACTURING_READ_TOOLS]
"""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason (network, auth, validation, etc.)."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _filters(**kwargs):
    """Builds an ERPNext filters list (e.g. [["status", "=", "Open"]])
    from keyword args, skipping any that are None so an unfiltered
    list_* call doesn't accidentally filter on an empty/absent value."""
    return [[key, "=", value] for key, value in kwargs.items() if value is not None]


def _format_records(records, empty_message):
    """Turns a list of dicts from get_list() into a short, readable
    bullet list instead of dumping raw Python dict reprs at the user —
    each record renders as its `name` followed by its other fields."""
    if not records:
        return empty_message

    lines = []
    for record in records:
        name = record.get("name", "?")
        rest = ", ".join(
            f"{k}: {v}" for k, v in record.items() if k != "name" and v not in (None, "")
        )
        lines.append(f"- {name}" + (f" ({rest})" if rest else ""))
    return "\n".join(lines)


# ---------------------------------------------------------------------
# Work Order
# ---------------------------------------------------------------------

@tool
def get_work_order(work_order_id: str):
    """Look up a single Work Order by its ID (e.g. 'WO-00001') — returns
    its item, quantity, produced quantity, status, warehouses, and
    planned start date. Use for requests like 'what's the status of
    WO-00001?' or 'how much has been produced on WO-00001?'."""

    def run():
        doc = erp_client.get_doc("Work Order", work_order_id)
        return str(doc)

    return _safe_call(f"look up work order {work_order_id}", run)


@tool
def list_work_orders(
    status: Optional[str] = None,
    production_item: Optional[str] = None,
    limit: int = 20,
):
    """List Work Orders, optionally filtered by `status` (one of 'Draft',
    'Not Started', 'In Process', 'Completed', 'Stopped', 'Closed') and/or
    `production_item` (an Item code). Returns the most recent `limit`
    matches (default 20) with quantity, produced quantity, and status.
    Use for requests like 'what work orders are in process?' or 'show me
    work orders for ITEM-FG-001'."""

    def run():
        records = erp_client.get_list(
            "Work Order",
            fields=[
                "name",
                "production_item",
                "qty",
                "produced_qty",
                "status",
                "planned_start_date",
            ],
            filters=_filters(status=status, production_item=production_item),
            order_by="modified desc",
            limit=limit,
        )
        return _format_records(records, "No work orders found matching that criteria.")

    return _safe_call("list work orders", run)


# ---------------------------------------------------------------------
# Production Plan
# ---------------------------------------------------------------------

@tool
def get_production_plan(production_plan_id: str):
    """Look up a single Production Plan by its ID (e.g.
    'MFG-PP-2026-00001') — returns its posting date, status, and planned
    items. Use for requests like 'what's on production plan MFG-PP-2026-
    00001?'."""

    def run():
        doc = erp_client.get_doc("Production Plan", production_plan_id)
        return str(doc)

    return _safe_call(f"look up production plan {production_plan_id}", run)


@tool
def list_production_plans(status: Optional[str] = None, limit: int = 20):
    """List Production Plans, optionally filtered by `status` (one of
    'Draft', 'Submitted', 'Not Started', 'In Process', 'Completed',
    'Cancelled'). Returns the most recent `limit` matches (default 20).
    Use for requests like 'show me open production plans'."""

    def run():
        records = erp_client.get_list(
            "Production Plan",
            fields=["name", "posting_date", "status", "docstatus"],
            filters=_filters(status=status),
            order_by="modified desc",
            limit=limit,
        )
        return _format_records(records, "No production plans found matching that criteria.")

    return _safe_call("list production plans", run)


# ---------------------------------------------------------------------
# Job Card
# ---------------------------------------------------------------------

@tool
def get_job_card(job_card_id: str):
    """Look up a single Job Card by its ID (e.g. 'JOB-CARD-00001') —
    returns its work order, operation, workstation, status, and
    quantity. Use for requests like 'what's the status of job card
    JOB-CARD-00001?'."""

    def run():
        doc = erp_client.get_doc("Job Card", job_card_id)
        return str(doc)

    return _safe_call(f"look up job card {job_card_id}", run)


@tool
def list_job_cards(
    work_order: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
):
    """List Job Cards, optionally filtered by `work_order` (a Work Order
    ID) and/or `status` (one of 'Open', 'Work In Progress', 'On Hold',
    'Completed'). Returns the most recent `limit` matches (default 20).
    Use for requests like 'what job cards are open for WO-00001?' or
    'show me job cards still in progress'."""

    def run():
        records = erp_client.get_list(
            "Job Card",
            fields=[
                "name",
                "work_order",
                "operation",
                "workstation",
                "status",
                "for_quantity",
            ],
            filters=_filters(work_order=work_order, status=status),
            order_by="modified desc",
            limit=limit,
        )
        return _format_records(records, "No job cards found matching that criteria.")

    return _safe_call("list job cards", run)


# ---------------------------------------------------------------------
# Stock (manufacturing-linked movements + live stock balance)
# ---------------------------------------------------------------------

@tool
def list_manufacture_stock_entries(
    work_order: Optional[str] = None,
    stock_entry_type: Optional[str] = None,
    limit: int = 20,
):
    """List manufacturing-related Stock Entries (material transfers into
    WIP, or finished-goods receipts out of manufacturing), optionally
    filtered by `work_order` (a Work Order ID) and/or `stock_entry_type`
    (one of 'Material Transfer for Manufacture', 'Manufacture'). Returns
    the most recent `limit` matches (default 20). Use for requests like
    'what stock entries have been made for WO-00001?'."""

    def run():
        filters = _filters(work_order=work_order, stock_entry_type=stock_entry_type)
        records = erp_client.get_list(
            "Stock Entry",
            fields=["name", "stock_entry_type", "work_order", "posting_date", "docstatus"],
            filters=filters,
            order_by="modified desc",
            limit=limit,
        )
        return _format_records(records, "No matching stock entries found.")

    return _safe_call("list manufacturing stock entries", run)


@tool
def get_stock_balance(item_code: str, warehouse: Optional[str] = None):
    """Look up the current stock balance (actual/reserved/projected
    quantity) for an Item, optionally narrowed to one `warehouse`. Reads
    from ERPNext's live Bin doctype, so this reflects real-time stock
    levels rather than a point-in-time report. Use for requests like
    'how much of ITEM-001 do we have?' or 'what's the stock of ITEM-001
    in the Finished Goods warehouse?'."""

    def run():
        records = erp_client.get_list(
            "Bin",
            fields=["item_code", "warehouse", "actual_qty", "reserved_qty", "projected_qty"],
            filters=_filters(item_code=item_code, warehouse=warehouse),
            limit=50,
        )
        return _format_records(
            records, f"No stock balance found for {item_code}" + (f" in {warehouse}." if warehouse else ".")
        )

    return _safe_call(f"look up stock balance for {item_code}", run)


MANUFACTURING_READ_TOOLS = [
    get_work_order,
    list_work_orders,
    get_production_plan,
    list_production_plans,
    get_job_card,
    list_job_cards,
    list_manufacture_stock_entries,
    get_stock_balance,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
# Only the tools where the lookup is meaningless without an ID/code need
# an entry here — every list_* tool works fine unfiltered, so none of
# them are listed.
REQUIRED_FIELDS = {
    "get_work_order": [
        ("work_order_id", "Which work order? (its ID, e.g. WO-00001)"),
    ],
    "get_production_plan": [
        ("production_plan_id", "Which production plan? (its ID, e.g. MFG-PP-2026-00001)"),
    ],
    "get_job_card": [
        ("job_card_id", "Which job card? (its ID, e.g. JOB-CARD-00001)"),
    ],
    "get_stock_balance": [
        ("item_code", "Which item's stock balance do you want to check?"),
    ],
}

# No read-tool answers need special parsing (unlike create_* tools'
# `items` fields) — kept here only for consistency with the write-tools
# modules, since ERP/tools/__init__.py merges every module's FIELD_PARSERS.
FIELD_PARSERS = {}
