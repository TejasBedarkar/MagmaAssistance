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

v16 note: the write tools below (create_lead, update_lead,
create_customer, ... create_sales_order) were migrated off the old
custom "sales_app" whitelisted-method API onto ERPNext's DEFAULT REST
API (POST/PUT /api/resource/<Doctype>, plus core frappe.client.submit
for submitting orders) via erp_client.create_doc()/update_doc()/
submit_doc() — mirrors ERP/tools/sales_write_tools.py exactly. See that
file's module docstring for the stock-v16 field-mapping notes (e.g. Lead
uses lead_name/email_id/mobile_no, Customer contact info lives on a
linked Contact, Opportunity uses opportunity_from/party_name/
sales_stage/expected_closing, etc.).

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


def _list_result(doctype, records, limit, filters=None, noun=None):
    """Formats a get_list() page together with the TRUE total count for
    `doctype`/`filters` (via erp_client.get_count), so the caller always
    knows whether it's looking at everything or just a page of it.

    Without this, every get_* list tool below used to return exactly
    `limit` records with no signal that more existed — e.g. get_customers
    defaulted to limit=20 and would silently show 20 of a real 306,
    which reads to the user (and the LLM composing the reply) as if
    those 20 were the whole list. Now the result always states the true
    total and, when truncated, says so explicitly and tells the caller
    how to see more (raise `limit`, or use a *_count tool for just the
    number).
    """
    noun = noun or doctype.lower()
    try:
        total = erp_client.get_count(doctype, filters=filters)
    except Exception:
        # If the count endpoint itself fails (e.g. an older Frappe
        # version without frappe.client.get_count whitelisted), don't
        # let that hide the records we DID get — just skip the total
        # rather than losing the whole response.
        return str(records)

    if total > len(records):
        return (
            f"{records}\n"
            f"(Showing {len(records)} of {total} total {noun} — this is not the "
            f"full list. Ask again with a higher `limit` to see more, or ask "
            f"for just the count.)"
        )
    return str(records)


# ---------------------------------------------------------------------
# Sales Orders (read)
# ---------------------------------------------------------------------

@mcp.tool()
def get_sales_orders(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get the most recent sales orders, including customer, date, total
    value, and status. Only returns up to `limit` (raise it, or ask for
    a count, if you need more than the default page)."""
    def run():
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "customer", "transaction_date", "grand_total", "status"],
            order_by="transaction_date desc",
            limit=limit,
        )
        return _list_result("Sales Order", orders, limit, noun="sales order(s)")
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
    Deliver and Bill', 'To Bill', or 'To Deliver'). Only returns up to
    `limit` (raise it, or ask for a count, if you need more than the
    default page)."""
    def run():
        filters = [["status", "in", ["To Deliver and Bill", "To Bill", "To Deliver"]]]
        orders = erp_client.get_list(
            "Sales Order",
            fields=["name", "customer", "transaction_date", "grand_total", "status"],
            filters=filters,
            order_by="transaction_date desc",
            limit=limit,
        )
        return _list_result("Sales Order", orders, limit, filters=filters, noun="pending sales order(s)")
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
def get_customers(limit: int = 50) -> str:
    """Get up to `limit` customers with basic details (name, customer
    group, territory) — NOT necessarily every customer. If there are
    more than `limit` in ERPNext, the result says so explicitly and
    tells you how many exist in total; raise `limit` to see more, or
    call get_customer_count for just the number without the full list."""
    def run():
        customers = erp_client.get_list(
            "Customer", fields=["name", "customer_name", "customer_group", "territory"], limit=limit,
        )
        return _list_result("Customer", customers, limit, noun="customer(s)")
    return _safe_call("fetch customer list", run)


@mcp.tool()
def get_customer_count(customer_group: Optional[str] = None, territory: Optional[str] = None) -> str:
    """Get the TOTAL number of customers in ERPNext, optionally filtered
    by `customer_group` or `territory`. Use this instead of counting
    get_customers results yourself — that tool only returns a page at a
    time and undercounts if there are more customers than its `limit`."""
    def run():
        filters = []
        if customer_group:
            filters.append(["customer_group", "=", customer_group])
        if territory:
            filters.append(["territory", "=", territory])
        total = erp_client.get_count("Customer", filters=filters or None)
        scope_bits = []
        if customer_group:
            scope_bits.append(f"group '{customer_group}'")
        if territory:
            scope_bits.append(f"territory '{territory}'")
        scope = f" in {' and '.join(scope_bits)}" if scope_bits else ""
        return f"{total} customer(s){scope}."
    return _safe_call("fetch customer count", run)


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
    """Get recent quotations, including customer, date, total value, and
    status. Only returns up to `limit` (raise it, or ask for a count, if
    you need more than the default page)."""
    def run():
        quotes = erp_client.get_list(
            "Quotation",
            fields=["name", "party_name", "transaction_date", "grand_total", "status"],
            order_by="transaction_date desc",
            limit=limit,
        )
        return _list_result("Quotation", quotes, limit, noun="quotation(s)")
    return _safe_call("fetch quotations", run)


@mcp.tool()
def get_outstanding_invoices(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get invoices that still have an unpaid (outstanding) balance. Only
    returns up to `limit` (raise it, or ask for a count, if you need
    more than the default page)."""
    def run():
        filters = [["outstanding_amount", ">", 0]]
        invoices = erp_client.get_list(
            "Sales Invoice",
            fields=["name", "customer", "posting_date", "grand_total", "outstanding_amount", "status"],
            filters=filters,
            order_by="posting_date desc",
            limit=limit,
        )
        return _list_result("Sales Invoice", invoices, limit, filters=filters, noun="outstanding invoice(s)")
    return _safe_call("fetch outstanding invoices", run)


# ---------------------------------------------------------------------
# Leads (read)
# ---------------------------------------------------------------------

@mcp.tool()
def get_leads(limit: int = DEFAULT_LIST_LIMIT) -> str:
    """Get the most recent leads, including name, company, status, and
    contact details. Only returns up to `limit` (raise it, or use
    get_lead_count if you need the total)."""
    def run():
        leads = erp_client.get_list(
            "Lead",
            fields=["name", "lead_name", "company_name", "status", "email_id", "mobile_no"],
            order_by="creation desc",
            limit=limit,
        )
        return _list_result("Lead", leads, limit, noun="lead(s)")
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
        total = erp_client.get_count("Lead", filters=filters)
        scope = f" with status '{status}'" if status else ""
        return f"{total} lead(s){scope}."
    return _safe_call("fetch lead count", run)


# ---------------------------------------------------------------------
# Lead / Customer / Opportunity / Quotation / Sales Order — WRITE
# (ERPNext v16 default REST API: POST/PUT /api/resource/<Doctype>, via
# erp_client.create_doc()/update_doc()/submit_doc() — see this file's
# module docstring and ERP/tools/sales_write_tools.py for field-mapping
# notes.)
# ---------------------------------------------------------------------

@mcp.tool()
def create_lead(
    name: str,
    product_interested: str,
    quantity: int,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    company: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    territory: Optional[str] = None,
) -> str:
    """Create a new sales Lead. `name` (the lead/contact person's name),
    `product_interested` (the product/item they want), and `quantity`
    (whole number of units) are all REQUIRED by the ERP Lead-creation
    API — the call fails without them, so always ask the user for these
    three before calling this tool if they weren't already given."""
    def run():
        data = _payload(lead_name=name, product_interested=product_interested,
                         quantity=quantity, email_id=email, mobile_no=phone,
                         company_name=company, status=status, source=source, territory=territory)
        return str(erp_client.create_doc("Lead", data))
    return _safe_call(f"create lead '{name}'", run)


@mcp.tool()
def update_lead(
    lead_id: str,
    lead_name: Optional[str] = None,
    status: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    company: Optional[str] = None,
) -> str:
    """Update an existing Lead identified by its ID/docname. Only fields provided are changed."""
    def run():
        data = _payload(lead_name=lead_name, status=status, mobile_no=phone,
                         email_id=email, company_name=company)
        if not data:
            return "Nothing to update — no fields were provided."
        return str(erp_client.update_doc("Lead", lead_id, data))
    return _safe_call(f"update lead {lead_id}", run)


@mcp.tool()
def create_customer(
    customer_name: str,
    customer_type: Optional[str] = None,
    customer_group: Optional[str] = None,
    territory: Optional[str] = None,
    email_id: Optional[str] = None,
    mobile_no: Optional[str] = None,
    lead_id: Optional[str] = None,
) -> str:
    """Create a new Customer. `customer_name` is required (e.g. 'ABC
    Industries'). If `email_id`/`mobile_no` is given, a linked Contact is
    also created, since ERPNext stores contact details on Contact rather
    than on Customer itself."""
    def run():
        customer_data = _payload(customer_name=customer_name, customer_type=customer_type,
                                  customer_group=customer_group, territory=territory, lead_name=lead_id)
        customer = erp_client.create_doc("Customer", customer_data)
        customer_id = customer.get("name", customer_name)

        if email_id or mobile_no:
            contact_data = {
                "first_name": customer_name,
                "links": [{"link_doctype": "Customer", "link_name": customer_id}],
            }
            if email_id:
                contact_data["email_ids"] = [{"email_id": email_id, "is_primary": 1}]
            if mobile_no:
                contact_data["phone_nos"] = [{"phone": mobile_no, "is_primary_mobile_no": 1}]
            try:
                erp_client.create_doc("Contact", contact_data)
            except Exception as exc:  # noqa: BLE001
                return str(customer) + f" (note: contact details could not be saved: {exc})"

        return str(customer)
    return _safe_call(f"create customer '{customer_name}'", run)


@mcp.tool()
def update_customer(
    customer_id: str,
    customer_name: Optional[str] = None,
    customer_type: Optional[str] = None,
    customer_group: Optional[str] = None,
    territory: Optional[str] = None,
) -> str:
    """Update an existing Customer identified by its ID. Only fields provided are changed."""
    def run():
        data = _payload(customer_name=customer_name, customer_type=customer_type,
                         customer_group=customer_group, territory=territory)
        if not data:
            return "Nothing to update — no fields were provided."
        return str(erp_client.update_doc("Customer", customer_id, data))
    return _safe_call(f"update customer {customer_id}", run)


@mcp.tool()
def create_opportunity(
    party_name: str,
    opportunity_from: Optional[str] = None,
    opportunity_amount: Optional[float] = None,
    sales_stage: Optional[str] = None,
    expected_closing: Optional[str] = None,
    probability: Optional[float] = None,
    source: Optional[str] = None,
) -> str:
    """Create a new Opportunity, typically linked to an existing Lead or
    Customer. `party_name` is that Lead's or Customer's ID (required).
    `opportunity_from` should be 'Lead' or 'Customer' (defaults to
    'Customer')."""
    def run():
        data = _payload(party_name=party_name, opportunity_from=opportunity_from or "Customer",
                         opportunity_amount=opportunity_amount, sales_stage=sales_stage,
                         expected_closing=expected_closing, probability=probability, source=source)
        return str(erp_client.create_doc("Opportunity", data))
    return _safe_call(f"create opportunity for {party_name}", run)


@mcp.tool()
def update_opportunity(
    opportunity_id: str,
    sales_stage: Optional[str] = None,
    opportunity_amount: Optional[float] = None,
    expected_closing: Optional[str] = None,
) -> str:
    """Update an existing Opportunity identified by its ID (e.g. 'OPTY-00001')."""
    def run():
        data = _payload(sales_stage=sales_stage, opportunity_amount=opportunity_amount,
                         expected_closing=expected_closing)
        if not data:
            return "Nothing to update — no fields were provided."
        return str(erp_client.update_doc("Opportunity", opportunity_id, data))
    return _safe_call(f"update opportunity {opportunity_id}", run)


@mcp.tool()
def create_quotation(customer: str, items: list, valid_till: Optional[str] = None) -> str:
    """Create a Quotation. `customer` is the customer ID (e.g. 'ABC Industries').
    `items` is a list of {item_code, qty, rate} dicts."""
    def run():
        data = _payload(quotation_to="Customer", party_name=customer,
                         transaction_date=date.today().isoformat(), items=items, valid_till=valid_till)
        return str(erp_client.create_doc("Quotation", data))
    return _safe_call(f"create quotation for {customer}", run)


@mcp.tool()
def update_quotation(quotation_id: str, items: Optional[list] = None, status: Optional[str] = None) -> str:
    """Update an existing DRAFT Quotation identified by its ID (e.g. 'QTN-00001')."""
    def run():
        data = _payload(items=items, status=status)
        if not data:
            return "Nothing to update — no fields were provided."
        return str(erp_client.update_doc("Quotation", quotation_id, data))
    return _safe_call(f"update quotation {quotation_id}", run)


@mcp.tool()
def create_sales_order(
    customer: str,
    items: list,
    delivery_date: Optional[str] = None,
    submit: bool = False,
) -> str:
    """Create a Sales Order. `customer` is the customer ID (e.g. 'ABC Industries').
    `items` is a list of {item_code, qty, rate, uom, warehouse} dicts.
    Set `submit` true to submit it immediately via ERPNext's core
    frappe.client.submit rather than leave it as a draft."""
    def run():
        data = _payload(customer=customer, transaction_date=date.today().isoformat(),
                         delivery_date=delivery_date or date.today().isoformat(), items=items)
        result = erp_client.create_doc("Sales Order", data)
        if submit:
            order_id = result.get("name")
            try:
                result = erp_client.submit_doc("Sales Order", order_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"
        return str(result)
    return _safe_call(f"create sales order for {customer}", run)


@mcp.tool()
def update_sales_order(sales_order_id: str, items: Optional[list] = None, delivery_date: Optional[str] = None) -> str:
    """Update an existing draft Sales Order identified by its ID (e.g. 'SO-00001')."""
    def run():
        data = _payload(items=items, delivery_date=delivery_date)
        if not data:
            return "Nothing to update — no fields were provided."
        return str(erp_client.update_doc("Sales Order", sales_order_id, data))
    return _safe_call(f"update sales order {sales_order_id}", run)


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.run(transport="streamable-http", host="0.0.0.0", port=8100)
    else:
        mcp.run()