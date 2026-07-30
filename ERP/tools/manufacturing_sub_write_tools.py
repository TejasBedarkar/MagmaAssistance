"""
ERP/tools/manufacturing_sub_write_tools.py

Create/update tools for the Subcontracting module (BOM, Subcontracting BOM,
Subcontracting Order, Subcontracting Receipt, and related write actions).
"""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.tools.sales_write_tools import _parse_items_answer


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _payload(**kwargs):
    """Drops keys whose value is None."""
    return {k: v for k, v in kwargs.items() if v is not None}


@tool
def create_bom(
    company: str,
    item: str,
    items: list,
    quantity: float = 1.0,
    submit: bool = False,
):
    """Create a new Bill of Materials (BOM) for an item to manufacture.
    `company`, `item` (the Item code to manufacture, e.g. 'FG-001'), and
    `items` (a list of raw materials, each a dict like {"item_code": "SKU010", "qty": 1.0})
    are all compulsory. `quantity` is the output quantity (defaults to 1.0).
    Set `submit` true to submit it immediately (making it active and ready for use).
    Use for requests like 'create a BOM for FG-001 with 1 unit of SKU010'."""

    def run():
        if not items:
            return "Could not create BOM: components items list cannot be empty."

        data = {
            "company": company,
            "item": item,
            "quantity": quantity,
            "items": items,
        }
        result = erp_client.create_doc("BOM", data)

        if submit:
            bom_id = result.get("name")
            try:
                result = erp_client.submit_doc("BOM", bom_id)
            except Exception as exc:
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create BOM for {item}", run)


@tool
def create_subcontracting_bom(
    finished_good: str,
    finished_good_bom: str,
    service_item: str,
    service_item_uom: str,
    finished_good_qty: float = 1.0,
    service_item_qty: float = 1.0,
    finished_good_uom: Optional[str] = None,
    conversion_factor: Optional[float] = None,
    is_active: int = 1,
):
    """Create a new Subcontracting BOM.
    `finished_good`, `finished_good_bom` (the BOM reference for the finished good),
    `service_item` (the subcontracting service item), and `service_item_uom` are compulsory.
    `finished_good_qty` and `service_item_qty` default to 1.0. `is_active` defaults to 1.
    Use for requests like 'create a subcontracting BOM for finished good FG-001 with service item SRV-001'."""

    def run():
        # Resolve finished_good_uom from Item if not provided
        uom = finished_good_uom
        if not uom:
            try:
                item_doc = erp_client.get_doc("Item", finished_good)
                uom = item_doc.get("stock_uom")
            except Exception:  # noqa: BLE001
                uom = None

        factor = (
            conversion_factor
            if conversion_factor is not None
            else (service_item_qty / finished_good_qty if finished_good_qty else 0.0)
        )

        # Deactivate existing active Subcontracting BOMs for this finished good to avoid ValidationError
        if is_active:
            try:
                existing = erp_client.get_list(
                    "Subcontracting BOM",
                    fields=["name"],
                    filters=[["finished_good", "=", finished_good], ["is_active", "=", 1]],
                    limit=1,
                    use_cache=False,
                )
                if existing:
                    erp_client.update_doc("Subcontracting BOM", existing[0]["name"], {"is_active": 0})
            except Exception:  # noqa: BLE001
                pass

        data = _payload(
            finished_good=finished_good,
            finished_good_qty=finished_good_qty,
            finished_good_bom=finished_good_bom,
            finished_good_uom=uom,
            service_item=service_item,
            service_item_qty=service_item_qty,
            service_item_uom=service_item_uom,
            conversion_factor=factor,
            is_active=is_active,
        )
        result = erp_client.create_doc("Subcontracting BOM", data)
        return str(result)

    return _safe_call(f"create Subcontracting BOM for {finished_good}", run)


MANUFACTURING_SUB_WRITE_TOOLS = [
    create_bom,
    create_subcontracting_bom,
]

REQUIRED_FIELDS = {
    "create_bom": [
        ("company", "For which company? (e.g. Magna Data Pvt Ltd)"),
        ("item", "Which item do you want to manufacture? (e.g. FG-001)"),
        ("items", "What raw materials and quantities are required? (e.g. SKU010, 1)"),
    ],
    "create_subcontracting_bom": [
        ("finished_good", "Which finished good is being subcontracted? (e.g. FG-001)"),
        ("finished_good_bom", "Which BOM reference for the finished good? (e.g. BOM-FG-001-003)"),
        ("service_item", "Which subcontracting service item? (e.g. SRV-001)"),
        ("service_item_uom", "Which UOM for the service item? (e.g. Nos)"),
    ],
}

FIELD_PARSERS = {
    ("create_bom", "items"): _parse_items_answer,
}
