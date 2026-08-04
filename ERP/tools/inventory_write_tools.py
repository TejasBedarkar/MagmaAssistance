"""
ERP/tools/inventory_write_tools.py

Create/update tools for the Inventory/Stock module, on ERPNext's DEFAULT
REST API (POST/PUT /api/resource/<Doctype>) via erp_client.create_doc() /
update_doc() / submit_doc() — same approach as sales_write_tools.py, just
for a different set of doctypes.

Field mapping notes (stock ERPNext v16 fieldnames):

  Item              item_code, item_name, item_group, stock_uom,
                    is_stock_item (1/0), description, disabled (1/0)
  Material Request  material_request_type ("Purchase"/"Material Transfer"/
                    "Material Issue"/"Manufacture"), schedule_date,
                    items (child table: item_code, qty, [warehouse])
  Stock Entry       stock_entry_type ("Material Transfer"/"Material
                    Issue"/"Material Receipt"/"Manufacture"/...),
                    from_warehouse, to_warehouse,
                    items (child table: item_code, qty, [s_warehouse,
                    t_warehouse] — falls back to the entry-level
                    from_warehouse/to_warehouse if a row doesn't set its
                    own)

`items` child-table rows follow ERPNext's standard shape:
    {"item_code": "ITEM-001", "qty": 50}
(add "rate"/"uom"/"warehouse" per row as needed for your site).

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
    from .inventory_write_tools import INVENTORY_WRITE_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *LEAD_TOOLS, *INVENTORY_WRITE_TOOLS]
"""

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
# Item
# ---------------------------------------------------------------------

@tool
def create_item(
    item_code: str,
    item_name: Optional[str] = None,
    item_group: Optional[str] = None,
    stock_uom: Optional[str] = None,
    is_stock_item: bool = True,
    description: Optional[str] = None,
):
    """Create a new Item (product/SKU). `item_code` is required and must
    be unique (e.g. 'ITEM-001'). `item_group` and `stock_uom` fall back
    to your ERPNext site's configured defaults if not given. Use for
    requests like 'add a new item ITEM-100, name Steel Bolt, group Raw
    Material, UOM Nos'."""

    def run():
        data = _payload(
            item_code=item_code,
            item_name=item_name or item_code,
            item_group=item_group,
            stock_uom=stock_uom,
            is_stock_item=1 if is_stock_item else 0,
            description=description,
        )
        result = erp_client.create_doc("Item", data)
        return str(result)

    return _safe_call(f"create item '{item_code}'", run)


@tool
def update_item(
    item_code: str,
    item_name: Optional[str] = None,
    item_group: Optional[str] = None,
    description: Optional[str] = None,
    disabled: Optional[bool] = None,
):
    """Update an existing Item identified by its item_code. Only the
    fields provided are changed. Use for requests like 'rename ITEM-001
    to Hex Bolt 10mm' or 'disable ITEM-050'."""

    def run():
        data = _payload(
            item_name=item_name,
            item_group=item_group,
            description=description,
            disabled=(1 if disabled else 0) if disabled is not None else None,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Item", item_code, data)
        return str(result)

    return _safe_call(f"update item {item_code}", run)


# ---------------------------------------------------------------------
# Material Request
# ---------------------------------------------------------------------

@tool
def create_material_request(
    items: list,
    material_request_type: Optional[str] = None,
    schedule_date: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Material Request (a request to purchase, transfer,
    issue, or manufacture stock). `items` is a list of line items, each
    a dict like {"item_code": "ITEM-001", "qty": 50} — at least one item
    is required. `material_request_type` should be one of 'Purchase',
    'Material Transfer', 'Material Issue', or 'Manufacture' (defaults to
    'Purchase'). `schedule_date` should be YYYY-MM-DD. Set `submit` true
    to submit it immediately rather than leave it as a draft. Use for
    requests like 'raise a material request for 100 units of ITEM-001'."""

    def run():
        data = _payload(
            material_request_type=material_request_type or "Purchase",
            schedule_date=schedule_date,
            items=items,
        )
        result = erp_client.create_doc("Material Request", data)

        if submit:
            request_id = result.get("name")
            try:
                result = erp_client.submit_doc("Material Request", request_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call("create material request", run)


@tool
def update_material_request(
    material_request_id: str,
    items: Optional[list] = None,
    schedule_date: Optional[str] = None,
):
    """Update an existing DRAFT Material Request identified by its ID
    (e.g. 'MAT-MR-2026-00001'). Only the fields provided are changed —
    passing `items` replaces the existing item set rather than merging
    with it. Only works while the request is still a draft (docstatus
    0)."""

    def run():
        data = _payload(items=items, schedule_date=schedule_date)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Material Request", material_request_id, data)
        return str(result)

    return _safe_call(f"update material request {material_request_id}", run)


# ---------------------------------------------------------------------
# Stock Entry
# ---------------------------------------------------------------------

@tool
def create_stock_entry(
    items: list,
    stock_entry_type: Optional[str] = None,
    from_warehouse: Optional[str] = None,
    to_warehouse: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Stock Entry — an actual movement of stock, e.g.
    transferring items between warehouses, issuing material out, or
    receiving material in. `items` is a list of line items, each a dict
    like {"item_code": "ITEM-001", "qty": 20} — at least one item is
    required. `stock_entry_type` should be one of 'Material Transfer',
    'Material Issue', 'Material Receipt', or 'Manufacture' (defaults to
    'Material Transfer'). `from_warehouse`/`to_warehouse` are required
    depending on the type (Transfer needs both, Issue needs from,
    Receipt needs to). Set `submit` true to submit it immediately rather
    than leave it as a draft. Use for requests like 'move 20 units of
    ITEM-001 from Stores to Finished Goods warehouse'."""

    def run():
        data = _payload(
            stock_entry_type=stock_entry_type or "Material Transfer",
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

    return _safe_call("create stock entry", run)


INVENTORY_WRITE_TOOLS = [
    create_item,
    update_item,
    create_material_request,
    update_material_request,
    create_stock_entry,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
REQUIRED_FIELDS = {
    "create_item": [
        ("item_code", "What's the item code?"),
    ],
    "update_item": [
        ("item_code", "Which item should I update? (its item code)"),
    ],
    "create_material_request": [
        (
            "items",
            "What items are needed? Give each as 'item code, quantity' — "
            "separate multiple items with a semicolon, e.g. "
            "'ITEM-001, 50; ITEM-002, 10'.",
        ),
    ],
    "update_material_request": [
        ("material_request_id", "Which material request should I update? (e.g. MAT-MR-2026-00001)"),
    ],
    "create_stock_entry": [
        (
            "items",
            "What items are moving? Give each as 'item code, quantity' — "
            "separate multiple items with a semicolon, e.g. "
            "'ITEM-001, 50; ITEM-002, 10'.",
        ),
    ],
}

# Reuses the same 'item code, qty[, rate]' free-text parser as
# sales_write_tools.py, since these items lists follow the same shape.
FIELD_PARSERS = {
    ("create_material_request", "items"): _parse_items_answer,
    ("create_stock_entry", "items"): _parse_items_answer,
}
