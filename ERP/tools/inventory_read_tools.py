"""Read-only tools for ERPNext Item and stock lookups."""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _safe_call(label, fn):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


@tool
def get_available_items(limit: int = 50, search: Optional[str] = None) -> str:
    """List available/enabled Items from the ERPNext Item master. Use this
    whenever the user asks for available items, all items, products, SKUs,
    item codes, or what can be added to an order or invoice. Optionally
    search by item code or item name. This is a read-only ERP lookup and
    does not require the user to provide category or supplier criteria."""

    def run():
        filters = [["disabled", "=", 0]]
        if search:
            # Frappe's REST list filters are ANDed, so fetch matching codes
            # and names independently and merge them for an intuitive OR.
            fields = ["name", "item_code", "item_name", "item_group", "stock_uom", "is_stock_item"]
            by_code = erp_client.get_list(
                "Item", fields=fields,
                filters=[*filters, ["item_code", "like", f"%{search}%"]],
                order_by="item_name asc", limit=limit,
            )
            by_name = erp_client.get_list(
                "Item", fields=fields,
                filters=[*filters, ["item_name", "like", f"%{search}%"]],
                order_by="item_name asc", limit=limit,
            )
            merged = {row.get("name") or row.get("item_code"): row for row in [*by_code, *by_name]}
            items = list(merged.values())[:limit]
        else:
            items = erp_client.get_list(
                "Item",
                fields=["name", "item_code", "item_name", "item_group", "stock_uom", "is_stock_item"],
                filters=filters,
                order_by="item_name asc",
                limit=limit,
            )
        if not items:
            scope = f" matching '{search}'" if search else ""
            return f"No enabled items{scope} were found in ERPNext."
        lines = []
        for row in items:
            code = row.get("item_code") or row.get("name") or "(no code)"
            name = row.get("item_name") or code
            details = [row.get("item_group"), row.get("stock_uom")]
            suffix = " · ".join(str(value) for value in details if value)
            lines.append(f"- {code} — {name}" + (f" ({suffix})" if suffix else ""))
        return f"Available items ({len(items)} shown):\n" + "\n".join(lines)

    return _safe_call("fetch available items", run)


INVENTORY_READ_TOOLS = [get_available_items]
