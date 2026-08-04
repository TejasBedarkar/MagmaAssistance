"""Read-only tools for ERPNext purchasing records."""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _safe_call(label, fn):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in MagnaERP right now ({exc})."


@tool
def get_purchase_orders(limit: int = 20, supplier: Optional[str] = None) -> str:
    """List recent Purchase Orders from ERPNext, optionally for a supplier.
    Use when the user wants to see, find, or choose a purchase order, including
    before creating a Purchase Invoice from one."""
    def run():
        filters = [["supplier", "=", supplier]] if supplier else None
        rows = erp_client.get_list(
            "Purchase Order",
            fields=["name", "supplier", "transaction_date", "grand_total", "status", "per_billed"],
            filters=filters, order_by="transaction_date desc", limit=limit, use_cache=False,
        )
        if not rows:
            return "Purchase Orders found: 0."
        lines = []
        for row in rows:
            order_id = row.get("name") or "(no ID)"
            supplier_name = row.get("supplier") or "(no supplier)"
            status = row.get("status") or "Unknown"
            order_date = row.get("transaction_date") or "date unavailable"
            total = row.get("grand_total") or 0
            billed = row.get("per_billed") or 0
            lines.append(
                f"- {order_id} — {supplier_name} — {status} — {order_date} — "
                f"total {total} — {billed}% billed"
            )
        return f"Purchase Orders found: {len(rows)}.\n" + "\n".join(lines)
    return _safe_call("fetch purchase orders", run)


@tool
def get_purchase_order_details(purchase_order_id: str) -> str:
    """Get a Purchase Order and all of its line items by its exact ERPNext
    document ID. Use to inspect an order before making a Purchase Invoice."""
    return _safe_call(
        f"fetch purchase order {purchase_order_id}",
        lambda: str(erp_client.get_doc("Purchase Order", purchase_order_id)),
    )


@tool
def get_purchase_invoices(limit: int = 20, supplier: Optional[str] = None) -> str:
    """List and count Purchase Invoices from ERPNext in every status,
    including drafts, unpaid, paid, overdue, and cancelled invoices. Use when
    the user asks how many Purchase Invoices exist or what they are."""
    def run():
        filters = [["supplier", "=", supplier]] if supplier else None
        rows = erp_client.get_list(
            "Purchase Invoice",
            fields=["name", "supplier", "posting_date", "due_date", "grand_total", "outstanding_amount", "status"],
            filters=filters, order_by="posting_date desc", limit=limit, use_cache=False,
        )
        if not rows:
            return "Purchase Invoices found: 0."
        lines = []
        for row in rows:
            lines.append(
                f"- {row.get('name') or '(no ID)'} — {row.get('supplier') or '(no supplier)'} — "
                f"{row.get('status') or 'Unknown'} — {row.get('posting_date') or 'date unavailable'} — "
                f"total {row.get('grand_total') or 0} — outstanding {row.get('outstanding_amount') or 0}"
            )
        return f"Purchase Invoices found: {len(rows)}.\n" + "\n".join(lines)
    return _safe_call("fetch purchase invoices", run)


PURCHASE_READ_TOOLS = [get_purchase_orders, get_purchase_order_details, get_purchase_invoices]
