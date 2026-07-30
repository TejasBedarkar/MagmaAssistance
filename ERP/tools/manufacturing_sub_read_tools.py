"""
ERP/tools/manufacturing_sub_read_tools.py

Look-up/list tools for Subcontracting module (BOM, Subcontracting BOM,
Subcontracting Order, Subcontracting Receipt, and related reports).
"""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.tools.manufacturing_read_tools import get_bom, list_boms


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _filters(**kwargs):
    """Builds an ERPNext filters list from keyword args, skipping any that are None."""
    return [[key, "=", value] for key, value in kwargs.items() if value is not None]


def _format_records(records, empty_message):
    """Turns a list of dicts from get_list() into a short, readable bullet list."""
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
# Subcontracting BOM
# ---------------------------------------------------------------------

@tool
def get_subcontracting_bom(subcontracting_bom_id: str):
    """Look up a single Subcontracting BOM by its ID (e.g. 'SUB-BOM-00001') — returns
    its active status, finished good item, quantity, finished good BOM, service item,
    and service item quantity. Use for requests like 'show details of Subcontracting BOM
    SUB-BOM-00001'."""

    def run():
        doc = erp_client.get_doc("Subcontracting BOM", subcontracting_bom_id)
        return str(doc)

    return _safe_call(f"look up Subcontracting BOM {subcontracting_bom_id}", run)


@tool
def list_subcontracting_boms(
    finished_good: Optional[str] = None,
    is_active: Optional[bool] = None,
    limit: int = 20,
):
    """List Subcontracting BOMs, optionally filtered by `finished_good` item code
    and/or `is_active` status (True/False). Returns the most recent `limit` matches (default 20).
    Use for requests like 'list all active subcontracting BOMs' or 'show subcontracting BOMs for FG-001'."""

    def run():
        active_val = (1 if is_active else 0) if is_active is not None else None
        records = erp_client.get_list(
            "Subcontracting BOM",
            fields=["name", "finished_good", "finished_good_qty", "finished_good_bom", "service_item", "is_active"],
            filters=_filters(finished_good=finished_good, is_active=active_val),
            order_by="modified desc",
            limit=limit,
        )
        return _format_records(records, "No Subcontracting BOMs found matching that criteria.")

    return _safe_call("list Subcontracting BOMs", run)


# ---------------------------------------------------------------------
# Subcontracting Order
# ---------------------------------------------------------------------

@tool
def get_subcontracting_order(subcontracting_order_id: str):
    """Look up a single Subcontracting Order by its ID (e.g. 'SCO-2026-00001') — returns
    its transaction date, company, supplier, supplier warehouse, status, purchase order,
    and percent received. Use for requests like 'what is the status of Subcontracting Order
    SCO-2026-00001?' or 'show details of SCO-2026-00001'."""

    def run():
        doc = erp_client.get_doc("Subcontracting Order", subcontracting_order_id)
        return str(doc)

    return _safe_call(f"look up Subcontracting Order {subcontracting_order_id}", run)


@tool
def list_subcontracting_orders(
    supplier: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
):
    """List Subcontracting Orders, optionally filtered by `supplier` and/or `status`
    (e.g., 'Draft', 'Submitted', 'Partially Received', 'Received', 'Closed'). Returns the most recent `limit` matches.
    Use for requests like 'show all subcontracting orders', 'list open subcontracting orders',
    or 'show subcontracting orders for Supplier XYZ'."""

    def run():
        records = erp_client.get_list(
            "Subcontracting Order",
            fields=["name", "supplier", "transaction_date", "company", "status", "per_received"],
            filters=_filters(supplier=supplier, status=status),
            order_by="modified desc",
            limit=limit,
        )
        return _format_records(records, "No Subcontracting Orders found matching that criteria.")

    return _safe_call("list Subcontracting Orders", run)


# ---------------------------------------------------------------------
# Subcontracting Receipt
# ---------------------------------------------------------------------

@tool
def get_subcontracting_receipt(subcontracting_receipt_id: str):
    """Look up a single Subcontracting Receipt by its ID (e.g. 'SCR-2026-00001') — returns
    its company, supplier, posting date, status, items received, and raw materials consumed.
    Use for requests like 'what are the details of Subcontracting Receipt SCR-2026-00001?'."""

    def run():
        doc = erp_client.get_doc("Subcontracting Receipt", subcontracting_receipt_id)
        return str(doc)

    return _safe_call(f"look up Subcontracting Receipt {subcontracting_receipt_id}", run)


@tool
def list_subcontracting_receipts(
    supplier: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
):
    """List Subcontracting Receipts, optionally filtered by `supplier` and/or `status`.
    Returns the most recent `limit` matches (default 20).
    Use for requests like 'list all subcontracting receipts' or 'show receipts from Supplier XYZ'."""

    def run():
        records = erp_client.get_list(
            "Subcontracting Receipt",
            fields=["name", "supplier", "posting_date", "company", "status"],
            filters=_filters(supplier=supplier, status=status),
            order_by="modified desc",
            limit=limit,
        )
        return _format_records(records, "No Subcontracting Receipts found matching that criteria.")

    return _safe_call("list Subcontracting Receipts", run)


# ---------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------

@tool
def get_subcontract_order_summary(
    company: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 20,
):
    """View the Subcontract Order Summary. Summarizes Subcontracting Orders by
    naming series, supplier, date, percent received, and status in a Markdown table.
    Supports filtering by `company`, `from_date` (YYYY-MM-DD), and `to_date` (YYYY-MM-DD).
    Use for requests like 'show me the Subcontract Order Summary for Magna Data Pvt Ltd' or
    'summarize subcontract orders from 2026-06-29 to 2026-07-29'."""

    def run():
        filters = []
        if company:
            filters.append(["company", "=", company])
        if from_date:
            filters.append(["transaction_date", ">=", from_date])
        if to_date:
            filters.append(["transaction_date", "<=", to_date])

        records = erp_client.get_list(
            "Subcontracting Order",
            fields=["name", "status"],
            filters=filters,
            order_by="modified desc",
            limit=limit,
        )
        if not records:
            return "No Subcontracting Orders found matching that criteria."

        # Cache for item names to avoid duplicate lookups
        item_names = {}

        def get_item_name(code):
            if code not in item_names:
                try:
                    doc = erp_client.get_doc("Item", code)
                    item_names[code] = doc.get("item_name") or ""
                except Exception:  # noqa: BLE001
                    item_names[code] = ""
            return item_names[code]

        lines = [
            "| Subcontracting Order | Status | Subcontracted Item | Order Qty | Received Qty | Supplied Item | Required Qty | Supplied Qty | Consumed Qty | Returned Qty |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]

        for r in records:
            doc = erp_client.get_doc("Subcontracting Order", r.get("name"))
            fg_items = {item.get("item_code"): item for item in doc.get("items", [])}
            supplied_items = doc.get("supplied_items", [])

            if not supplied_items:
                for fg_item in doc.get("items", []):
                    code = fg_item.get("item_code")
                    name = fg_item.get("item_name") or get_item_name(code)
                    lines.append(
                        f"| {doc.get('name')} | {doc.get('status')} | {code}: {name} | "
                        f"{float(fg_item.get('qty') or 0):.3f} | {float(fg_item.get('received_qty') or 0):.3f} | "
                        f"- | 0.000 | 0.000 | 0.000 | 0.000 |"
                    )
            else:
                for rm_item in supplied_items:
                    main_item_code = rm_item.get("main_item_code")
                    fg_item = fg_items.get(main_item_code)

                    if fg_item:
                        code = fg_item.get("item_code")
                        name = fg_item.get("item_name") or get_item_name(code)
                        fg_item_display = f"{code}: {name}"
                        fg_qty = float(fg_item.get("qty") or 0)
                        fg_rec = float(fg_item.get("received_qty") or 0)
                    else:
                        fg_item_display = f"{main_item_code}: {get_item_name(main_item_code)}"
                        fg_qty = 0.0
                        fg_rec = 0.0

                    rm_code = rm_item.get("rm_item_code")
                    rm_name = get_item_name(rm_code)
                    rm_item_display = f"{rm_code}: {rm_name}" if rm_name else rm_code

                    lines.append(
                        f"| {doc.get('name')} | {doc.get('status')} | {fg_item_display} | "
                        f"{fg_qty:.3f} | {fg_rec:.3f} | {rm_item_display} | "
                        f"{float(rm_item.get('required_qty') or 0):.3f} | "
                        f"{float(rm_item.get('supplied_qty') or 0):.3f} | "
                        f"{float(rm_item.get('consumed_qty') or 0):.3f} | "
                        f"{float(rm_item.get('returned_qty') or 0):.3f} |"
                    )

        return "\n".join(lines)

    return _safe_call("get Subcontract Order Summary", run)


@tool
def list_subcontracted_raw_materials_to_be_transferred(
    company: Optional[str] = None,
    limit: int = 20,
):
    """List subcontracted raw materials that are pending transfer to suppliers in a Markdown table.
    Fetches raw materials from active Subcontracting Orders where the required quantity
    exceeds the supplied quantity. Supports filtering by `company`.
    Use for requests like 'what subcontracted raw materials need to be transferred?' or
    'list pending raw material transfers for subcontracting for Magna Data Pvt Ltd'."""

    def run():
        filters = [["status", "not in", ["Closed", "Completed"]]]
        if company:
            filters.append(["company", "=", company])

        orders = erp_client.get_list(
            "Subcontracting Order",
            fields=["name", "supplier", "company"],
            filters=filters,
            limit=100,
        )
        if not orders:
            return "No active Subcontracting Orders found."

        pending_transfers = []
        for order in orders:
            doc = erp_client.get_doc("Subcontracting Order", order.get("name"))
            supplied_items = doc.get("supplied_items", [])
            for item in supplied_items:
                req_qty = float(item.get("required_qty") or 0)
                sup_qty = float(item.get("supplied_qty") or 0)
                if req_qty > sup_qty:
                    pending_transfers.append({
                        "order": order.get("name"),
                        "company": order.get("company"),
                        "supplier": order.get("supplier"),
                        "rm_item": item.get("rm_item_code"),
                        "required": req_qty,
                        "supplied": sup_qty,
                        "pending": req_qty - sup_qty,
                    })

        if not pending_transfers:
            return "All raw materials for active subcontracting orders have been fully transferred."

        lines = [
            "| Subcontracting Order | Company | Supplier | Raw Material | Required Qty | Supplied Qty | Pending Transfer |",
            "| --- | --- | --- | --- | --- | --- | --- |"
        ]
        for pt in pending_transfers[:limit]:
            lines.append(
                f"| {pt['order']} | {pt['company']} | {pt['supplier']} | {pt['rm_item']} | "
                f"{pt['required']:.3f} | {pt['supplied']:.3f} | {pt['pending']:.3f} |"
            )
        return "\n".join(lines)

    return _safe_call("list subcontracted raw materials to be transferred", run)


@tool
def list_subcontracted_items_to_be_received(
    company: Optional[str] = None,
    limit: int = 20,
):
    """List subcontracted finished items that are pending receipt from suppliers in a Markdown table.
    Fetches finished goods from active Subcontracting Orders that have not been fully received.
    Supports filtering by `company`.
    Use for requests like 'what subcontracted items are pending receipt?' or
    'list subcontracted items to be received for Magna Data Pvt Ltd'."""

    def run():
        filters = [["status", "not in", ["Closed", "Completed"]], ["per_received", "<", 100]]
        if company:
            filters.append(["company", "=", company])

        orders = erp_client.get_list(
            "Subcontracting Order",
            fields=["name", "supplier", "company", "per_received", "status"],
            filters=filters,
            limit=100,
        )
        if not orders:
            return "No subcontracted items pending receipt."

        lines = [
            "| Subcontracting Order | Company | Supplier | Finished Good Item | Ordered Qty | Received Qty | Pending Receipt |",
            "| --- | --- | --- | --- | --- | --- | --- |"
        ]
        for order in orders:
            doc = erp_client.get_doc("Subcontracting Order", order.get("name"))
            items = doc.get("items", [])
            for item in items:
                qty = float(item.get("qty") or 0)
                received = float(item.get("received_qty") or 0)
                if qty > received:
                    lines.append(
                        f"| {order.get('name')} | {order.get('company')} | {order.get('supplier')} | {item.get('item_code')} | "
                        f"{qty:.3f} | {received:.3f} | {qty - received:.3f} |"
                    )
        return "\n".join(lines)

    return _safe_call("list subcontracted items to be received", run)


MANUFACTURING_SUB_READ_TOOLS = [
    get_subcontracting_bom,
    list_subcontracting_boms,
    get_subcontracting_order,
    list_subcontracting_orders,
    get_subcontracting_receipt,
    list_subcontracting_receipts,
    get_subcontract_order_summary,
    list_subcontracted_raw_materials_to_be_transferred,
    list_subcontracted_items_to_be_received,
]

REQUIRED_FIELDS = {
    "get_subcontracting_bom": [
        ("subcontracting_bom_id", "Which Subcontracting BOM? (its ID, e.g. SUB-BOM-00001)"),
    ],
    "get_subcontracting_order": [
        ("subcontracting_order_id", "Which Subcontracting Order? (its ID, e.g. SCO-2026-00001)"),
    ],
    "get_subcontracting_receipt": [
        ("subcontracting_receipt_id", "Which Subcontracting Receipt? (its ID, e.g. SCR-2026-00001)"),
    ],
}

FIELD_PARSERS = {}
