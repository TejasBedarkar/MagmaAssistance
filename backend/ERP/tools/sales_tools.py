"""
ERP/tools/sales_tools.py

Every sales-related tool the agent can call, all backed by ERPNext's
standard REST API via ERP/erp_client.py. Each tool:
  - has a specific, natural-language docstring (this doubles as what
    ToolRAG embeds for retrieval, and what the LLM sees when deciding
    whether to call it — vague docstrings hurt both).
  - never raises — ERP/network failures are caught and turned into a
    short string the LLM can relay honestly, per the system prompt's
    "if data is unavailable, clearly state that" rule.
  - only reads data. No create/update/delete tools here on purpose.

Add this list to ERP/tools/__init__.py:
    from .sales_tools import SALES_TOOLS
    ALL_TOOLS = [*SALES_TOOLS]
"""

from datetime import date, timedelta
from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client

DEFAULT_LIST_LIMIT = 10


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason (network, auth, bad doctype, etc.)."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not fetch {label} from ERPNext right now ({exc})."


def _default(value, fallback):
    """Resolves an optional tool argument to its real default.

    Small local models (llama3.2 and similar) will often call a tool with
    an argument explicitly set to `null` instead of omitting it entirely.
    Pydantic validates tool args against the function's type hints before
    the function body ever runs, and a plain `int`/`str` hint rejects
    `None` outright — the Python-level default (`limit: int = 10`) never
    even gets a chance to kick in. Declaring params as Optional[...] = None
    and resolving the real default here, inside the function body, sidesteps
    that validation error entirely.
    """
    return fallback if value is None else value


# ---------------------------------------------------------------------
# Sales Orders
# ---------------------------------------------------------------------

@tool
def get_sales_orders(limit: Optional[int] = None):
    """Get the most recent sales orders, including customer, date,
    total value, and status. Use for questions like 'show recent sales
    orders' or 'what orders came in this week'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "customer", "transaction_date", "grand_total", "status"],
            order_by="transaction_date desc",
            limit=limit,
        )
        return str(orders)

    return _safe_call("sales orders", run)


@tool
def get_sales_order_details(order_id: str):
    """Get full details of one specific sales order by its ID/name
    (e.g. 'SO-2026-00042'), including items, quantities, and totals."""
    def run():
        return str(erp_client.get_doc("Sales Order", order_id))

    return _safe_call(f"sales order {order_id}", run)


@tool
def get_pending_sales_orders(limit: Optional[int] = None):
    """Get sales orders that are not yet fully delivered or billed
    (status 'To Deliver and Bill', 'To Bill', or 'To Deliver'). Use for
    questions like 'what orders are still pending' or 'what's outstanding
    to ship'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "customer", "transaction_date", "grand_total", "status"],
            filters=[["status", "in", ["To Deliver and Bill", "To Bill", "To Deliver"]]],
            order_by="transaction_date desc",
            limit=limit,
        )
        return str(orders)

    return _safe_call("pending sales orders", run)


# ---------------------------------------------------------------------
# Sales Summary / Aggregates
# ---------------------------------------------------------------------

@tool
def get_sales_summary(period_days: Optional[int] = None):
    """Get an overall sales summary for the last N days (default 30):
    total order count, total value, and a breakdown by status. Use for
    questions like 'how are sales doing', 'give me a sales summary', or
    'how much have we sold this month'."""
    period_days = _default(period_days, 30)

    def run():
        since = (date.today() - timedelta(days=period_days)).isoformat()
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "grand_total", "status"],
            filters=[["transaction_date", ">=", since]],
            limit=1000,
        )
        total_value = sum(o.get("grand_total") or 0 for o in orders)
        by_status = {}
        for o in orders:
            status = o.get("status", "Unknown")
            by_status[status] = by_status.get(status, 0) + 1

        summary = {
            "period_days": period_days,
            "order_count": len(orders),
            "total_value": total_value,
            "by_status": by_status,
        }
        return str(summary)

    return _safe_call("sales summary", run)


@tool
def get_sales_by_date_range(start_date: str, end_date: str):
    """Get total sales value and order count between two dates
    (format YYYY-MM-DD). Use for questions like 'what were sales between
    March 1 and March 15' or comparing two specific periods."""
    def run():
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "customer", "grand_total", "status"],
            filters=[
                ["transaction_date", ">=", start_date],
                ["transaction_date", "<=", end_date],
            ],
            limit=1000,
        )
        total_value = sum(o.get("grand_total") or 0 for o in orders)
        return str({
            "start_date": start_date,
            "end_date": end_date,
            "order_count": len(orders),
            "total_value": total_value,
            "orders": orders[:20],  # cap the raw list even if more matched
        })

    return _safe_call("sales for that date range", run)


@tool
def get_top_selling_items(limit: Optional[int] = None, period_days: Optional[int] = None):
    """Get the best-selling items/products by quantity sold in the last
    N days (default 30). Use for questions like 'what are our top selling
    products' or 'what's moving the most'."""
    limit = _default(limit, 5)
    period_days = _default(period_days, 30)

    def run():
        since = (date.today() - timedelta(days=period_days)).isoformat()
        rows = erp_client.get_list(
            "Sales Order Item",
            fields=["item_code", "item_name", "qty", "amount"],
            filters=[["parenttype", "=", "Sales Order"], ["creation", ">=", since]],
            limit=2000,
        )
        totals = {}
        for row in rows:
            key = row.get("item_name") or row.get("item_code")
            entry = totals.setdefault(key, {"qty": 0, "amount": 0})
            entry["qty"] += row.get("qty") or 0
            entry["amount"] += row.get("amount") or 0

        ranked = sorted(totals.items(), key=lambda kv: kv[1]["qty"], reverse=True)[:limit]
        return str([{"item": name, **totals} for name, totals in ranked])

    return _safe_call("top selling items", run)


# ---------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------

@tool
def get_customers(limit: Optional[int] = None):
    """Get the list of customers with basic details (name, customer
    group, territory). Use for questions like 'list our customers' or
    'how many customers do we have'."""
    limit = _default(limit, 20)

    def run():
        customers = erp_client.get_list(
            "Customer",
            fields=["name", "customer_name", "customer_group", "territory"],
            limit=limit,
        )
        return str(customers)

    return _safe_call("customer list", run)


@tool
def get_customer_sales_history(customer_name: str, limit: Optional[int] = None):
    """Get the recent sales order history for one specific customer by
    name. Use for questions like 'what has [customer] ordered recently'
    or 'show me [customer]'s order history'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "transaction_date", "grand_total", "status"],
            filters=[["customer", "=", customer_name]],
            order_by="transaction_date desc",
            limit=limit,
        )
        return str(orders)

    return _safe_call(f"sales history for {customer_name}", run)


@tool
def get_top_customers(limit: Optional[int] = None, period_days: Optional[int] = None):
    """Get the top customers by total sales value over the last N days
    (default 90). Use for questions like 'who are our best customers' or
    'which customer bought the most this quarter'."""
    limit = _default(limit, 5)
    period_days = _default(period_days, 90)

    def run():
        since = (date.today() - timedelta(days=period_days)).isoformat()
        orders = erp_client.get_list(
            "Sales Order",
            fields=["customer", "grand_total"],
            filters=[["transaction_date", ">=", since]],
            limit=2000,
        )
        totals = {}
        for o in orders:
            customer = o.get("customer", "Unknown")
            totals[customer] = totals.get(customer, 0) + (o.get("grand_total") or 0)

        ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        return str([{"customer": name, "total_value": value} for name, value in ranked])

    return _safe_call("top customers", run)


# ---------------------------------------------------------------------
# Quotations
# ---------------------------------------------------------------------

@tool
def get_quotations(limit: Optional[int] = None):
    """Get recent quotations, including customer, date, total value, and
    status. Use for questions like 'show recent quotations' or 'what
    quotes have we sent out'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        quotations = erp_client.get_list(
            "Quotation",
            fields=["name", "party_name", "transaction_date", "grand_total", "status"],
            order_by="transaction_date desc",
            limit=limit,
        )
        return str(quotations)

    return _safe_call("quotations", run)


@tool
def get_pending_quotations(limit: Optional[int] = None):
    """Get quotations that haven't been converted to a sales order yet
    (status 'Open' or 'Draft'). Use for questions like 'what quotes are
    still open' or 'which quotes haven't converted'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        quotations = erp_client.get_list(
            "Quotation",
            fields=["name", "party_name", "transaction_date", "grand_total", "status"],
            filters=[["status", "in", ["Open", "Draft"]]],
            order_by="transaction_date desc",
            limit=limit,
        )
        return str(quotations)

    return _safe_call("pending quotations", run)


# ---------------------------------------------------------------------
# Invoices / Payments
# ---------------------------------------------------------------------

@tool
def get_sales_invoices(limit: Optional[int] = None):
    """Get recent sales invoices, including customer, date, total,
    outstanding amount, and status. Use for questions like 'show recent
    invoices' or 'what have we billed recently'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        invoices = erp_client.get_list(
            "Sales Invoice",
            fields=["name", "customer", "posting_date", "grand_total", "outstanding_amount", "status"],
            order_by="posting_date desc",
            limit=limit,
        )
        return str(invoices)

    return _safe_call("sales invoices", run)


@tool
def get_outstanding_invoices(limit: Optional[int] = None):
    """Get invoices that still have an unpaid (outstanding) balance. Use
    for questions like 'what invoices are unpaid' or 'what's still owed
    to us'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        invoices = erp_client.get_list(
            "Sales Invoice",
            fields=["name", "customer", "posting_date", "grand_total", "outstanding_amount", "status"],
            filters=[["outstanding_amount", ">", 0]],
            order_by="posting_date desc",
            limit=limit,
        )
        return str(invoices)

    return _safe_call("outstanding invoices", run)


@tool
def get_overdue_invoices(limit: Optional[int] = None):
    """Get invoices that are both unpaid AND past their due date. Use for
    questions like 'what invoices are overdue' or 'which customers are
    late on payment'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        today = date.today().isoformat()
        invoices = erp_client.get_list(
            "Sales Invoice",
            fields=["name", "customer", "due_date", "grand_total", "outstanding_amount", "status"],
            filters=[
                ["outstanding_amount", ">", 0],
                ["due_date", "<", today],
            ],
            order_by="due_date asc",
            limit=limit,
        )
        return str(invoices)

    return _safe_call("overdue invoices", run)


@tool
def get_recent_payments(limit: Optional[int] = None):
    """Get recently received customer payments, including amount, date,
    and which party paid. Use for questions like 'what payments came in
    recently' or 'show recent collections'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        payments = erp_client.get_list(
            "Payment Entry",
            fields=["name", "party", "posting_date", "paid_amount", "status"],
            filters=[["payment_type", "=", "Receive"]],
            order_by="posting_date desc",
            limit=limit,
        )
        return str(payments)

    return _safe_call("recent payments", run)


SALES_TOOLS = [
    get_sales_orders,
    get_sales_order_details,
    get_pending_sales_orders,
    get_sales_summary,
    get_sales_by_date_range,
    get_top_selling_items,
    get_customers,
    get_customer_sales_history,
    get_top_customers,
    get_quotations,
    get_pending_quotations,
    get_sales_invoices,
    get_outstanding_invoices,
    get_overdue_invoices,
    get_recent_payments,
]