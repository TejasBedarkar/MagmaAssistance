"""
ERP/mcp_server.py

Exposes this project's ERP CRUD actions as MCP tools, so any MCP client
(this project's own agent loop, Claude Desktop, another internal tool)
can call them over a standard protocol instead of importing Python
functions directly.

Reuses ERP/erp_client.py as-is — same .env (ERP_URL, ERP_API_KEY,
ERP_API_SECRET), same caching, same auth. This file only adds the MCP
transport layer on top; it does not duplicate any HTTP/auth logic.

This is a 1:1 port of the tool set already in ERP/tools/sales_tools.py,
ERP/tools/sales_write_tools.py, and ERP/tools/lead_tools.py — same
actions, same docstrings-as-descriptions, same "never raise, return a
string" convention — just exposed via @mcp.tool() instead of @tool so an
MCP client can discover and call them.

Run standalone:
    python -m ERP.mcp_server            # stdio (same-host client)
    python -m ERP.mcp_server --http      # streamable HTTP on :8100

Install:
    pip install fastmcp
"""

import sys
from datetime import date, timedelta
from typing import Optional

from fastmcp import FastMCP

from ERP.erp_client import erp_client

mcp = FastMCP(name="sales-app-erp")

DEFAULT_LIST_LIMIT = 10
COUNT_FETCH_LIMIT = 5000


def _safe_call(label, fn):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _payload(**kwargs):
    return {k: v for k, v in kwargs.items() if v is not None}


# ---------------------------------------------------------------------
# Sales Orders (read)
# ---------------------------------------------------------------------

@mcp.tool()
def get_sales_orders(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get the most recent sales orders, including customer, date, total
    value, and status."""
    def run():
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "customer", "transaction_date", "grand_total", "status"],
            order_by="transaction_date desc",
            limit=limit,
        )
        return str(orders)
    return _safe_call("fetch sales orders", run)


@mcp.tool()
def get_sales_order_details(order_id: str) -> str:
    """Get full details of one specific sales order by its ID (e.g. 'SO-2026-00042')."""
    def run():
        return str(erp_client.get_doc("Sales Order", order_id))
    return _safe_call(f"fetch sales order {order_id}", run)


@mcp.tool()
def get_pending_sales_orders(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get sales orders not yet fully delivered or billed (status 'To
    Deliver and Bill', 'To Bill', or 'To Deliver')."""
    def run():
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "customer", "transaction_date", "grand_total", "status"],
            filters=[["status", "in", ["To Deliver and Bill", "To Bill", "To Deliver"]]],
            order_by="transaction_date desc",
            limit=limit,
        )
        return str(orders)
    return _safe_call("fetch pending sales orders", run)


@mcp.tool()
def get_sales_summary(period_days: int = 30) -> str:
    """Get an overall sales summary for the last N days: total order
    count, total value, and a breakdown by status."""
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
            by_status[o.get("status", "Unknown")] = by_status.get(o.get("status", "Unknown"), 0) + 1
        return str({"period_days": period_days, "order_count": len(orders),
                     "total_value": total_value, "by_status": by_status})
    return _safe_call("fetch sales summary", run)


# ---------------------------------------------------------------------
# Customers (read)
# ---------------------------------------------------------------------

@mcp.tool()
def get_customers(limit: int = 20) -> str:
    """Get the list of customers with basic details (name, customer group, territory)."""
    def run():
        return str(erp_client.get_list(
            "Customer", fields=["name", "customer_name", "customer_group", "territory"], limit=limit,
        ))
    return _safe_call("fetch customer list", run)


@mcp.tool()
def get_customer_sales_history(customer_name: str, limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get the recent sales order history for one specific customer by name."""
    def run():
        return str(erp_client.get_list(
            "Sales Order",
            fields=["name", "transaction_date", "grand_total", "status"],
            filters=[["customer", "=", customer_name]],
            order_by="transaction_date desc",
            limit=limit,
        ))
    return _safe_call(f"fetch sales history for {customer_name}", run)


# ---------------------------------------------------------------------
# Quotations / Invoices (read)
# ---------------------------------------------------------------------

@mcp.tool()
def get_quotations(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get recent quotations, including customer, date, total value, and status."""
    def run():
        return str(erp_client.get_list(
            "Quotation",
            fields=["name", "party_name", "transaction_date", "grand_total", "status"],
            order_by="transaction_date desc",
            limit=limit,
        ))
    return _safe_call("fetch quotations", run)


@mcp.tool()
def get_outstanding_invoices(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get invoices that still have an unpaid (outstanding) balance."""
    def run():
        return str(erp_client.get_list(
            "Sales Invoice",
            fields=["name", "customer", "posting_date", "grand_total", "outstanding_amount", "status"],
            filters=[["outstanding_amount", ">", 0]],
            order_by="posting_date desc",
            limit=limit,
        ))
    return _safe_call("fetch outstanding invoices", run)


# ---------------------------------------------------------------------
# Leads (read)
# ---------------------------------------------------------------------

@mcp.tool()
def get_leads(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get the most recent leads, including name, company, status, and contact details."""
    def run():
        return str(erp_client.get_list(
            "Lead",
            fields=["name", "lead_name", "company_name", "status", "email_id", "mobile_no"],
            order_by="creation desc",
            limit=limit,
        ))
    return _safe_call("fetch leads", run)


@mcp.tool()
def get_lead_details(lead_id: str) -> str:
    """Get full details of one specific lead by its ID (e.g. 'LEAD-00001')."""
    def run():
        return str(erp_client.get_doc("Lead", lead_id))
    return _safe_call(f"fetch lead {lead_id}", run)


@mcp.tool()
def get_lead_count(status: Optional[str] = None) -> str:
    """Get the total number of leads, optionally filtered by status
    (e.g. 'Open', 'Contacted', 'Converted')."""
    def run():
        filters = [["status", "=", status]] if status else None
        leads = erp_client.get_list("Lead", fields=["name"], filters=filters, limit=COUNT_FETCH_LIMIT)
        scope = f" with status '{status}'" if status else ""
        return f"{len(leads)} lead(s){scope}."
    return _safe_call("fetch lead count", run)


# ---------------------------------------------------------------------
# Lead / Customer / Opportunity / Quotation / Sales Order — WRITE
# (all POST /api/method/sales_app.api.*, via erp_client.call_method_post)
# ---------------------------------------------------------------------

@mcp.tool()
def create_lead(
    name: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    company: Optional[str] = None,
    product_interested: Optional[str] = None,
    quantity: Optional[str] = None,
    notes: Optional[str] = None,
) -> str:
    """Create a new sales Lead. `name` is the lead/contact person's name (required)."""
    def run():
        data = _payload(name=name, email=email, phone=phone, company=company,
                         product_interested=product_interested, quantity=quantity, notes=notes)
        return str(erp_client.call_method_post("sales_app.api.lead.create_lead", data))
    return _safe_call(f"create lead '{name}'", run)


@mcp.tool()
def update_lead(
    lead_id: str,
    status: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    notes: Optional[str] = None,
) -> str:
    """Update an existing Lead identified by its ID (e.g. 'LEAD-00001'). Only fields provided are changed."""
    def run():
        data = _payload(name=lead_id, status=status, phone=phone, email=email, notes=notes)
        return str(erp_client.call_method_post("sales_app.api.lead.update_lead", data))
    return _safe_call(f"update lead {lead_id}", run)


@mcp.tool()
def create_customer(
    customer_name: str,
    customer_type: Optional[str] = None,
    territory: Optional[str] = None,
    email_id: Optional[str] = None,
    mobile_no: Optional[str] = None,
    lead_id: Optional[str] = None,
) -> str:
    """Create a new Customer. `customer_name` is required (e.g. 'ABC Industries')."""
    def run():
        data = _payload(customer_name=customer_name, customer_type=customer_type, territory=territory,
                         email_id=email_id, mobile_no=mobile_no, lead_id=lead_id)
        return str(erp_client.call_method_post("sales_app.api.customer.create_customer", data))
    return _safe_call(f"create customer '{customer_name}'", run)


@mcp.tool()
def update_customer(
    customer_id: str,
    territory: Optional[str] = None,
    payment_terms: Optional[str] = None,
    credit_limit: Optional[float] = None,
) -> str:
    """Update an existing Customer identified by its ID (e.g. 'CUST-0001'). Only fields provided are changed."""
    def run():
        data = _payload(name=customer_id, territory=territory, payment_terms=payment_terms, credit_limit=credit_limit)
        return str(erp_client.call_method_post("sales_app.api.customer.update_customer", data))
    return _safe_call(f"update customer {customer_id}", run)


@mcp.tool()
def create_opportunity(
    lead: str,
    opportunity_name: str,
    expected_revenue: float,
    stage: str = "Discussion",
    close_date: Optional[str] = None,
) -> str:
    """Create a new Opportunity, typically linked to an existing Lead."""
    def run():
        data = _payload(lead=lead, opportunity_name=opportunity_name,
                         expected_revenue=expected_revenue, stage=stage, close_date=close_date)
        return str(erp_client.call_method_post("sales_app.api.opportunity.create_opportunity", data))
    return _safe_call(f"create opportunity '{opportunity_name}'", run)


@mcp.tool()
def update_opportunity(
    opportunity_id: str,
    stage: Optional[str] = None,
    expected_revenue: Optional[float] = None,
) -> str:
    """Update an existing Opportunity identified by its ID (e.g. 'OPP-00001')."""
    def run():
        data = _payload(name=opportunity_id, stage=stage, expected_revenue=expected_revenue)
        return str(erp_client.call_method_post("sales_app.api.opportunity.update_opportunity", data))
    return _safe_call(f"update opportunity {opportunity_id}", run)


@mcp.tool()
def create_quotation(customer: str, items: list, valid_till: Optional[str] = None, note: Optional[str] = None) -> str:
    """Create a Quotation. `customer` is the customer ID (e.g. 'CUST-0001').
    `items` is a list of {item_code, qty, rate} dicts."""
    def run():
        data = _payload(customer=customer, items=items, valid_till=valid_till, note=note)
        return str(erp_client.call_method_post("sales_app.api.quotation.create_quotation", data))
    return _safe_call(f"create quotation for {customer}", run)


@mcp.tool()
def update_quotation(quotation_id: str, status: Optional[str] = None, note: Optional[str] = None) -> str:
    """Update an existing Quotation identified by its ID (e.g. 'QTN-00001')."""
    def run():
        data = _payload(name=quotation_id, status=status, note=note)
        return str(erp_client.call_method_post("sales_app.api.quotation.update_quotation", data))
    return _safe_call(f"update quotation {quotation_id}", run)


@mcp.tool()
def create_sales_order(
    customer: str,
    items: list,
    delivery_date: Optional[str] = None,
    submit: bool = False,
) -> str:
    """Create a Sales Order. `customer` is the customer ID (e.g. 'CUST-0001').
    `items` is a list of {item_code, qty, rate, uom, warehouse} dicts."""
    def run():
        data = _payload(customer=customer, items=items, delivery_date=delivery_date, submit=1 if submit else 0)
        return str(erp_client.call_method_post("sales_app.api.sales_order.create_sales_order", data))
    return _safe_call(f"create sales order for {customer}", run)


@mcp.tool()
def update_sales_order(sales_order_id: str, delivery_date: Optional[str] = None, note: Optional[str] = None) -> str:
    """Update an existing draft Sales Order identified by its ID (e.g. 'SO-00001')."""
    def run():
        data = _payload(name=sales_order_id, delivery_date=delivery_date, note=note)
        return str(erp_client.call_method_post("sales_app.api.sales_order.update_sales_order", data))
    return _safe_call(f"update sales order {sales_order_id}", run)


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.run(transport="streamable-http", host="0.0.0.0", port=8100)
    else:
        mcp.run()
