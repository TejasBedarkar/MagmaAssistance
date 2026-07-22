"""
ERP/tools/purchase_write_tools.py

Create/update tools for the Buying/Purchase module, on ERPNext's DEFAULT
REST API (POST/PUT /api/resource/<Doctype>) via erp_client.create_doc() /
update_doc() / submit_doc() — same approach as sales_write_tools.py, just
for a different set of doctypes.

Field mapping notes (stock ERPNext v16 fieldnames):

  Supplier          supplier_name, supplier_group, supplier_type
                    ("Company"/"Individual"), country, email_id,
                    mobile_no (email/mobile create a linked Contact, same
                    as create_customer() does for Customer)
  Purchase Order    supplier, transaction_date, schedule_date,
                    items (child table: item_code, qty, rate) —
                    submittable (docstatus 0 -> 1)
  Purchase Invoice  supplier, due_date, items (child table: item_code,
                    qty, rate) — submittable (docstatus 0 -> 1)

`items` child-table rows follow ERPNext's standard shape:
    {"item_code": "ITEM-001", "qty": 50, "rate": 1200}

Same conventions as sales_write_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — failures are caught and turned into a short string the
    LLM can relay honestly.
  - optional args are typed Optional[...] = None and resolved inside the
    function body so small local models passing explicit `null` don't
    trip Pydantic validation, and _payload() drops None values so an
    update only touches fields the caller actually specified.

Add this list to ERP/tools/__init__.py:
    from .purchase_write_tools import PURCHASE_WRITE_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *LEAD_TOOLS, *PURCHASE_WRITE_TOOLS]
"""

# Add at Line 1 of ERP/tools/purchase_write_tools.py
import os
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()

from datetime import date
from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.tools.sales_write_tools import _parse_items_answer


# `_safe_call` now delegates to ERP.dynamic_fields.safe_call, which turns
# a raised exception into a plain-language explanation (missing field,
# bad link value, duplicate record, permission issue, ERPNext
# unreachable, etc.) via explain_erp_error() instead of just relaying
# the raw Python/HTTP exception text.
from ERP.dynamic_fields import safe_call as _safe_call


def _payload(**kwargs):
    """Drops keys whose value is None, so update_* tools only send the
    fields the caller actually specified instead of nulling out every
    field the user didn't mention."""
    return {k: v for k, v in kwargs.items() if v is not None}


# ---------------------------------------------------------------------
# Supplier (+ a linked Contact for email/mobile, same as create_customer)
# ---------------------------------------------------------------------

@tool
def create_supplier(
    supplier_name: str,
    supplier_group: Optional[str] = None,
    supplier_type: Optional[str] = None,
    country: Optional[str] = None,
    email_id: Optional[str] = None,
    mobile_no: Optional[str] = None,
):
    """Create a new Supplier in ERPNext manually. `supplier_name` is required (e.g. 'Global
    Steel Supplies'). `supplier_group` falls back to 'All Supplier Groups' if not provided or invalid.
    `supplier_type` should be 'Company' or 'Individual'. If `email_id` or `mobile_no` is given,
    a linked Contact is created automatically."""

    def run():
        # Fallback for supplier_group to avoid ERPNext 417 Expectation Failed
        final_supplier_group = supplier_group or "All Supplier Groups"

        supplier_data = _payload(
            supplier_name=supplier_name,
            supplier_group=final_supplier_group,
            supplier_type=supplier_type or "Company",
            country=country,
        )
        supplier = erp_client.create_doc("Supplier", supplier_data)
        supplier_id = supplier.get("name", supplier_name)

        if email_id or mobile_no:
            contact_data = {
                "first_name": supplier_name,
                "links": [{"link_doctype": "Supplier", "link_name": supplier_id}],
            }
            if email_id:
                contact_data["email_ids"] = [{"email_id": email_id, "is_primary": 1}]
            if mobile_no:
                contact_data["phone_nos"] = [{"phone": mobile_no, "is_primary_mobile_no": 1}]
            try:
                erp_client.create_doc("Contact", contact_data)
            except Exception as exc:  # noqa: BLE001
                return str(supplier) + f" (note: contact details could not be saved: {exc})"

        return str(supplier)

    return _safe_call(f"create supplier '{supplier_name}'", run)


@tool
def update_supplier(
    supplier_id: str,
    supplier_name: Optional[str] = None,
    supplier_group: Optional[str] = None,
    supplier_type: Optional[str] = None,
    country: Optional[str] = None,
):
    """Update an existing Supplier identified by its ID (in stock
    ERPNext this is usually the supplier_name itself, unless your site
    uses a naming series). Only the fields provided are changed."""

    def run():
        data = _payload(
            supplier_name=supplier_name,
            supplier_group=supplier_group,
            supplier_type=supplier_type,
            country=country,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Supplier", supplier_id, data)
        return str(result)

    return _safe_call(f"update supplier {supplier_id}", run)


# ---------------------------------------------------------------------
# Purchase Order
# ---------------------------------------------------------------------

@tool
def create_purchase_order(
    supplier: str,
    items: list,
    schedule_date: Optional[str] = None,
    submit: bool = False,
):
    """MANUAL TOOL: Create a new Purchase Order for an existing supplier from user prompt arguments.
    `supplier` is the Supplier ID/Name. `items` is a list of line items dict like
    {"item_code": "ITEM-001", "qty": 50, "rate": 1200}. `schedule_date` defaults to today (YYYY-MM-DD).
    NOTE: Do NOT use this tool for processing uploaded PDF/Image documents (use process_ocr_po_and_create_order instead)."""

    def run():
        data = _payload(
            supplier=supplier,
            transaction_date=date.today().isoformat(),
            schedule_date=schedule_date or date.today().isoformat(),
            items=items,
        )
        result = erp_client.create_doc("Purchase Order", data)

        if submit:
            order_id = result.get("name")
            try:
                result = erp_client.submit_doc("Purchase Order", order_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create purchase order for {supplier}", run)


@tool
def update_purchase_order(
    purchase_order_id: str,
    items: Optional[list] = None,
    schedule_date: Optional[str] = None,
):
    """Update an existing DRAFT Purchase Order identified by its ID
    (e.g. 'PUR-ORD-2026-00001'). Only the fields provided are changed —
    passing `items` replaces the existing item set rather than merging
    with it. Only edits a draft order (docstatus 0); a submitted order
    needs a separate amendment, not a plain update."""

    def run():
        data = _payload(items=items, schedule_date=schedule_date)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Purchase Order", purchase_order_id, data)
        return str(result)

    return _safe_call(f"update purchase order {purchase_order_id}", run)


# ---------------------------------------------------------------------
# Purchase Invoice
# ---------------------------------------------------------------------

@tool
def create_purchase_invoice(
    supplier: str,
    items: list,
    due_date: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Purchase Invoice (a supplier's bill) for a supplier.
    `supplier` is the Supplier ID. `items` is a list of line items, each
    a dict like {"item_code": "ITEM-001", "qty": 50, "rate": 1200} — at
    least one item is required. `due_date` should be YYYY-MM-DD (defaults to today if missing).
    Set `submit` true to submit it immediately rather than leave it as a draft."""

    def run():
        data = _payload(
            supplier=supplier,
            posting_date=date.today().isoformat(),
            due_date=due_date or date.today().isoformat(),
            items=items,
        )
        result = erp_client.create_doc("Purchase Invoice", data)

        if submit:
            invoice_id = result.get("name")
            try:
                result = erp_client.submit_doc("Purchase Invoice", invoice_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create purchase invoice for {supplier}", run)


PURCHASE_WRITE_TOOLS = [
    create_supplier,
    update_supplier,
    create_purchase_order,
    update_purchase_order,
    create_purchase_invoice,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
REQUIRED_FIELDS = {
    "create_supplier": [
        ("supplier_name", "What's the supplier name?"),
    ],
    "update_supplier": [
        ("supplier_id", "Which supplier should I update?"),
    ],
    "create_purchase_order": [
        ("supplier", "Which supplier is this purchase order for?"),
        (
            "items",
            "What items should be on the order? Give each as "
            "'item code, quantity, rate' — separate multiple items with a "
            "semicolon, e.g. 'ITEM-001, 50, 1200; ITEM-002, 10, 500'.",
        ),
    ],
    "update_purchase_order": [
        ("purchase_order_id", "Which purchase order should I update? (e.g. PUR-ORD-2026-00001)"),
    ],
    "create_purchase_invoice": [
        ("supplier", "Which supplier is this invoice from?"),
        (
            "items",
            "What items should be on the invoice? Give each as "
            "'item code, quantity, rate' — separate multiple items with a "
            "semicolon, e.g. 'ITEM-001, 50, 1200; ITEM-002, 10, 500'.",
        ),
    ],
}

FIELD_PARSERS = {
    ("create_purchase_order", "items"): _parse_items_answer,
    ("create_purchase_invoice", "items"): _parse_items_answer,
}