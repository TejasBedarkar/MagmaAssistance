"""
ERP/tools/manufacturing_write_tools.py

Create/update tools for the Manufacturing module, on ERPNext's DEFAULT
REST API (POST/PUT /api/resource/<Doctype>) via erp_client.create_doc() /
update_doc() / submit_doc() — same approach as sales_write_tools.py /
inventory_write_tools.py, just for a different set of doctypes.

Field mapping notes (stock ERPNext v16 fieldnames — if your site has
Customize Form additions on top of stock, extend the `_payload(...)`
calls below to match):

  Work Order        Required: company, production_item, qty,
                     fg_warehouse (target warehouse), wip_warehouse.
                     bom_no is NOT required from the caller — it is
                     auto-fetched from the item's active default BOM
                     via _get_default_bom(), exactly like ERPNext's desk
                     UI does the instant you pick an item. Optional:
                     source_warehouse, planned_start_date. status is
                     auto-managed by ERPNext as linked Stock
                     Entries/Job Cards progress — don't set it directly.

  Production Plan    Required: company, items (child table, each row
                     needs at least item_code + planned_qty) — sent to
                     ERPNext under the payload key `po_items`, which is
                     what this doctype's item child table is actually
                     called (confirmed via a live MandatoryError:
                     po_items response; the public tool param stays
                     named `items` for a friendlier API). bom_no per row
                     is auto-fetched the same way as Work Order if not
                     supplied. Optional: posting_date (defaults
                     to today). Submitting a Production Plan does NOT
                     create Work Orders by itself in stock ERPNext —
                     that's a separate "Make Work Order" action in the
                     desk UI backed by a whitelisted method, not the
                     plain REST create — so create_production_plan here
                     only creates the plan document; use
                     create_work_order per item to actually schedule
                     production.

  Job Card           Required: work_order, company, operation,
                     workstation, wip_warehouse, item_code. Optional:
                     for_quantity, employee (child table `employee` —
                     kept simple as a single employee ID string here;
                     extend to a list if your site tracks multiple
                     operators per card). Job Cards are usually
                     auto-created when a Work Order is submitted (one
                     per operation in its routing) — create_job_card
                     here is for the case where you need to add one
                     manually. status moves Open -> Work In Progress ->
                     Completed and is normally driven by time-log
                     actions in the UI, but is exposed here via
                     update_job_card for simple status changes from the
                     assistant.

  Stock (Manufacture) Required: company, stock_entry_type ('Manufacture'
                     or 'Material Transfer for Manufacture'), items.
                     Optional: work_order (links the stock movement back
                     to the job so ERPNext can track material
                     issued/received against it). items child table
                     follows the same shape as inventory_write_tools.py's
                     create_stock_entry: {"item_code": "ITEM-001",
                     "qty": 20} (add "s_warehouse"/"t_warehouse" per
                     row as needed).

`items` child-table rows follow ERPNext's standard shape:
    {"item_code": "ITEM-001", "qty": 50}
(add "rate"/"uom"/"warehouse" per row as needed for your site).

BOM auto-fetch: `_get_default_bom(item_code)` runs a GET against the
BOM doctype (item = item_code, is_default = 1, docstatus = 1) and
returns its `name`, so bom_no never needs to be asked of the user —
matching how the ERPNext desk UI auto-fills it the moment an item is
selected on a Work Order or Production Plan row. If the item has no
submitted default BOM, the tool returns a clear error instead of
silently creating a doc ERPNext will reject.


Same conventions as sales_write_tools.py / inventory_write_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — failures are caught and turned into a short string the
    LLM can relay honestly.
  - optional args are typed Optional[...] = None and resolved inside the
    function body so small local models passing explicit `null` don't
    trip Pydantic validation, and _payload() drops None values so an
    update only touches fields the caller actually specified.

Add this list to ERP/tools/__init__.py:
    from .manufacturing_write_tools import MANUFACTURING_WRITE_TOOLS
    ALL_TOOLS = [..., *MANUFACTURING_WRITE_TOOLS]
"""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.tools.sales_write_tools import _parse_items_answer


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason (network, auth, validation, etc.)."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _payload(**kwargs):
    """Drops keys whose value is None, so update_* tools only send the
    fields the caller actually specified instead of nulling out every
    field the user didn't mention."""
    return {k: v for k, v in kwargs.items() if v is not None}


def _get_default_bom(item_code: str) -> Optional[str]:
    """Looks up the active default BOM for an item, same as ERPNext's
    desk UI does the moment you pick an Item on a Work Order / Production
    Plan — so the assistant never needs to ask the user for a BOM number.
    Returns None if the item has no default BOM (e.g. it's a purchased
    item, or no BOM has been submitted for it yet)."""
    records = erp_client.get_list(
        "BOM",
        fields=["name"],
        filters=[["item", "=", item_code], ["is_default", "=", 1], ["docstatus", "=", 1]],
        limit=1,
    )
    return records[0]["name"] if records else None


# ---------------------------------------------------------------------
# Work Order
# ---------------------------------------------------------------------

@tool
def create_work_order(
    company: str,
    production_item: str,
    qty: float,
    fg_warehouse: str,
    wip_warehouse: str,
    bom_no: Optional[str] = None,
    source_warehouse: Optional[str] = None,
    planned_start_date: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Work Order to manufacture a quantity of an item.
    `company`, `production_item` (the Item code being manufactured, e.g.
    'ITEM-FG-001'), `qty`, `fg_warehouse` (target warehouse the finished
    goods go into), and `wip_warehouse` (work-in-progress warehouse) are
    all required. `bom_no` should NOT be asked from the user — it is
    looked up automatically from the item's active default BOM, exactly
    like ERPNext's desk UI does the moment an item is selected; only
    pass it explicitly if the user names a specific non-default BOM.
    `planned_start_date` should be YYYY-MM-DD. Set `submit` true to
    submit it immediately (which triggers Job Card creation for each
    routing operation) rather than leave it as a draft. Use for requests
    like 'create a work order to manufacture 100 units of ITEM-FG-001'."""

    def run():
        resolved_bom = bom_no or _get_default_bom(production_item)
        if not resolved_bom:
            return (
                f"Could not create the work order — item {production_item} has no "
                "active default BOM, so a bom_no must be provided explicitly."
            )

        data = _payload(
            company=company,
            production_item=production_item,
            qty=qty,
            bom_no=resolved_bom,
            wip_warehouse=wip_warehouse,
            fg_warehouse=fg_warehouse,
            source_warehouse=source_warehouse,
            planned_start_date=planned_start_date,
        )
        result = erp_client.create_doc("Work Order", data)

        if submit:
            order_id = result.get("name")
            try:
                result = erp_client.submit_doc("Work Order", order_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create work order for {production_item}", run)


@tool
def update_work_order(
    work_order_id: str,
    qty: Optional[float] = None,
    planned_start_date: Optional[str] = None,
    wip_warehouse: Optional[str] = None,
    fg_warehouse: Optional[str] = None,
):
    """Update an existing DRAFT Work Order identified by its ID (e.g.
    'WO-00001'). Only the fields provided are changed. Only edits a
    draft order (docstatus 0) — a submitted Work Order needs the
    standard ERPNext 'Update Qty'/close flow, not a plain field update.
    Use for requests like 'change the planned start date on WO-00001
    to next Monday'."""

    def run():
        data = _payload(
            qty=qty,
            planned_start_date=planned_start_date,
            wip_warehouse=wip_warehouse,
            fg_warehouse=fg_warehouse,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Work Order", work_order_id, data)
        return str(result)

    return _safe_call(f"update work order {work_order_id}", run)


# ---------------------------------------------------------------------
# Production Plan
# ---------------------------------------------------------------------

@tool
def create_production_plan(
    company: str,
    items: list,
    posting_date: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Production Plan — a planning document listing what
    to manufacture before raising individual Work Orders. `company` is
    required. `items` is a list of line items, each a dict like
    {"item_code": "ITEM-FG-001", "planned_qty": 100} — at least one item
    is required. `bom_no` should NOT be asked from the user for any
    item — it is looked up automatically from that item's active default
    BOM, exactly like ERPNext's desk UI does the moment an item is
    selected; only include "bom_no" in a row if the user names a
    specific non-default BOM for that item. `posting_date` should be
    YYYY-MM-DD, defaults to today. Set `submit` true to submit it
    immediately rather than leave it as a draft. Note: submitting a
    Production Plan does not automatically create Work Orders — those
    still need to be created separately per item. Use for requests like
    'create a production plan to manufacture 100 units of ITEM-FG-001
    and 50 units of ITEM-FG-002'."""

    def run():
        resolved_items = []
        for row in items:
            row = dict(row)
            if not row.get("bom_no"):
                default_bom = _get_default_bom(row.get("item_code", ""))
                if not default_bom:
                    return (
                        f"Could not create the production plan — item "
                        f"{row.get('item_code')} has no active default BOM, so a "
                        "bom_no must be provided explicitly for it."
                    )
                row["bom_no"] = default_bom
            resolved_items.append(row)

        data = _payload(
            company=company,
            posting_date=posting_date,
            items=resolved_items,
        )
        # Production Plan's item child table field is named `po_items` in
        # ERPNext (not `items`), so rekey right before sending — this
        # was found via a live MandatoryError: po_items response.
        data["po_items"] = data.pop("items")
        result = erp_client.create_doc("Production Plan", data)

        if submit:
            plan_id = result.get("name")
            try:
                result = erp_client.submit_doc("Production Plan", plan_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call("create production plan", run)


@tool
def update_production_plan(
    production_plan_id: str,
    items: Optional[list] = None,
    posting_date: Optional[str] = None,
):
    """Update an existing DRAFT Production Plan identified by its ID
    (e.g. 'MFG-PP-2026-00001'). Only the fields provided are changed —
    passing `items` replaces the existing item set rather than merging
    with it. Only works while the plan is still a draft (docstatus 0)."""

    def run():
        data = _payload(posting_date=posting_date)
        if items is not None:
            data["po_items"] = items
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Production Plan", production_plan_id, data)
        return str(result)

    return _safe_call(f"update production plan {production_plan_id}", run)


# ---------------------------------------------------------------------
# Job Card
# ---------------------------------------------------------------------

@tool
def create_job_card(
    work_order: str,
    company: str,
    operation: str,
    workstation: str,
    wip_warehouse: str,
    item_code: str,
    for_quantity: Optional[float] = None,
    employee: Optional[str] = None,
):
    """Create a new Job Card for a Work Order — tracks a single shop-
    floor operation (e.g. 'Cutting', 'Assembly') being carried out.
    `work_order` (the Work Order ID this card belongs to), `company`,
    `operation`, `workstation`, `wip_warehouse`, and `item_code` (the
    item being worked on) are all required. `employee` is a single
    employee ID (e.g. 'HR-EMP-00007') if given — internally it's sent as
    a one-row child table entry, since Job Card's `employee` field is a
    child table (it can hold multiple operators), not a plain text
    field; passing a bare string there is what ERPNext's API rejects
    with a 500 error. Note: ERPNext normally auto-creates one Job Card
    per routing operation when a Work Order is submitted, so this is
    mainly for adding an extra/manual card. Use for requests like
    'create a job card for WO-00001, operation Assembly, workstation
    Assembly Line 1, quantity 50'."""

    def run():
        data = _payload(
            work_order=work_order,
            company=company,
            operation=operation,
            workstation=workstation,
            wip_warehouse=wip_warehouse,
            item_code=item_code,
            for_quantity=for_quantity,
            employee=[{"employee": employee}] if employee else None,
        )
        result = erp_client.create_doc("Job Card", data)
        return str(result)

    return _safe_call(f"create job card for work order {work_order}", run)


@tool
def update_job_card(
    job_card_id: str,
    status: Optional[str] = None,
    for_quantity: Optional[float] = None,
    employee: Optional[str] = None,
):
    """Update an existing Job Card identified by its ID (e.g.
    'JOB-CARD-00001'). Only the fields provided are changed. `status`
    should be one of 'Open', 'Work In Progress', 'On Hold', or
    'Completed'. Use for requests like 'mark job card JOB-CARD-00001 as
    Completed' or 'assign job card JOB-CARD-00001 to employee HR-EMP-
    00007'."""

    def run():
        data = _payload(
            status=status,
            for_quantity=for_quantity,
            employee=[{"employee": employee}] if employee else None,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Job Card", job_card_id, data)
        return str(result)

    return _safe_call(f"update job card {job_card_id}", run)


# ---------------------------------------------------------------------
# Stock (manufacturing-linked movements)
# ---------------------------------------------------------------------

@tool
def create_manufacture_stock_entry(
    company: str,
    stock_entry_type: str,
    items: list,
    work_order: Optional[str] = None,
    from_warehouse: Optional[str] = None,
    to_warehouse: Optional[str] = None,
    submit: bool = False,
):
    """Create a Stock Entry tied to manufacturing — either transferring
    raw materials into work-in-progress for a Work Order, or receiving
    the finished goods out of it. `company`, `stock_entry_type`, and
    `items` are all required. `stock_entry_type` should be one of
    'Material Transfer for Manufacture' (raw materials -> WIP) or
    'Manufacture' (WIP -> finished goods). `items` is a list of line
    items, each a dict like {"item_code": "ITEM-001", "qty": 20} — at
    least one item is required. Pass `work_order` to link this stock
    movement back to the Work Order it belongs to — ERPNext uses this to
    track how much material has been issued/received against that
    order. Set `submit` true to submit it immediately rather than leave
    it as a draft. Use for requests like 'transfer materials for work
    order WO-00001 to the WIP warehouse'."""

    def run():
        data = _payload(
            company=company,
            stock_entry_type=stock_entry_type,
            work_order=work_order,
            from_warehouse=from_warehouse,
            to_warehouse=to_warehouse,
            items=items,
        )
        result = erp_client.create_doc("Stock Entry", data)

        if submit:
            entry_id = result.get("name")
            try:
                result = erp_client.submit_doc("Stock Entry", entry_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call("create manufacturing stock entry", run)


MANUFACTURING_WRITE_TOOLS = [
    create_work_order,
    update_work_order,
    create_production_plan,
    update_production_plan,
    create_job_card,
    update_job_card,
    create_manufacture_stock_entry,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
REQUIRED_FIELDS = {
    "create_work_order": [
        ("company", "Which company is this work order for?"),
        ("production_item", "Which item should this work order manufacture?"),
        ("qty", "What quantity should be manufactured?"),
        ("fg_warehouse", "Which warehouse should the finished goods go into (target warehouse)?"),
        ("wip_warehouse", "Which work-in-progress (WIP) warehouse should be used?"),
    ],
    "update_work_order": [
        ("work_order_id", "Which work order should I update? (e.g. WO-00001)"),
    ],
    "create_production_plan": [
        ("company", "Which company is this production plan for?"),
        (
            "items",
            "What items should be planned? Give each as "
            "'item code, planned quantity' — separate multiple items "
            "with a semicolon, e.g. 'ITEM-FG-001, 100; ITEM-FG-002, 50'.",
        ),
    ],
    "update_production_plan": [
        ("production_plan_id", "Which production plan should I update? (e.g. MFG-PP-2026-00001)"),
    ],
    "create_job_card": [
        ("work_order", "Which work order is this job card for? (its ID)"),
        ("company", "Which company is this job card for?"),
        ("operation", "Which operation is this job card for (e.g. Cutting, Assembly)?"),
        ("workstation", "Which workstation should this job card use?"),
        ("wip_warehouse", "Which work-in-progress (WIP) warehouse should be used?"),
        ("item_code", "Which item is this job card producing?"),
    ],
    "update_job_card": [
        ("job_card_id", "Which job card should I update? (its ID)"),
    ],
    "create_manufacture_stock_entry": [
        ("company", "Which company is this stock entry for?"),
        (
            "stock_entry_type",
            "What type of stock entry is this — 'Material Transfer for "
            "Manufacture' or 'Manufacture'?",
        ),
        (
            "items",
            "What items are moving? Give each as 'item code, quantity' — "
            "separate multiple items with a semicolon, e.g. "
            "'ITEM-001, 50; ITEM-002, 10'.",
        ),
    ],
}

# Reuses the same 'item code, qty[, rate]' free-text parser as
# sales_write_tools.py / inventory_write_tools.py, since these items
# lists follow the same shape. create_production_plan's items use
# "planned_qty" rather than "qty" as the payload key, so its answer is
# post-processed separately below.
FIELD_PARSERS = {
    ("create_manufacture_stock_entry", "items"): _parse_items_answer,
}


def _parse_production_plan_items_answer(text: str) -> list:
    """Same free-text format as _parse_items_answer ('item code, qty'),
    but Production Plan's child table field is `planned_qty`, not `qty`,
    so this re-keys after parsing rather than duplicating the parsing
    logic."""
    parsed = _parse_items_answer(text)
    for row in parsed:
        if "qty" in row:
            row["planned_qty"] = row.pop("qty")
    return parsed


FIELD_PARSERS[("create_production_plan", "items")] = _parse_production_plan_items_answer