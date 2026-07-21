"""
ERP/tools/sales_write_tools.py

Create/update tools for the agent — MIGRATED to ERPNext v16's DEFAULT
REST API (POST/PUT /api/resource/<Doctype>) via erp_client.create_doc() /
update_doc() / submit_doc(), replacing the old custom "sales_app"
whitelisted-method calls (POST /api/method/sales_app.api.*) that don't
exist anymore now that the custom app is gone.

Field mapping notes (stock ERPNext v16 fieldnames — if your site has
Customize Form additions on top of stock, extend the `_payload(...)`
calls below to match):

  Lead          lead_name, company_name, email_id, mobile_no, status,
                source, territory
  Customer      customer_name, customer_type, customer_group, territory,
                lead_name (link back to the Lead it came from).
                Email/mobile are NOT fields on Customer itself in stock
                ERPNext — they live on a linked Contact — so
                create_customer() also creates a Contact doc when
                email_id/mobile_no is given, same as the ERPNext UI does
                when you convert a Lead.
  Opportunity   opportunity_from ("Lead"/"Customer"), party_name,
                opportunity_amount, sales_stage, expected_closing,
                probability, source, contact_email, contact_mobile
  Quotation     quotation_to ("Customer"/"Lead"), party_name,
                transaction_date, valid_till, items (child table),
                order_type
  Sales Order   customer, transaction_date, delivery_date,
                items (child table), order_type

`items` child-table rows follow ERPNext's standard shape:
    {"item_code": "ITEM-001", "qty": 50, "rate": 1200}
(add "uom"/"warehouse" per row if your items require them).

Same conventions as sales_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — failures are caught and turned into a short string the
    LLM can relay honestly.
  - optional args are typed Optional[...] = None and resolved inside the
    function body so small local models passing explicit `null` don't
    trip Pydantic validation, and _payload() drops None values so an
    update only touches fields the caller actually specified.

Add this list to ERP/tools/__init__.py:
    from .sales_write_tools import SALES_WRITE_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS]
"""

from datetime import date
from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


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


# ---------------------------------------------------------------------
# Lead
# ---------------------------------------------------------------------

@tool
def create_lead(
    name: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    company: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    territory: Optional[str] = None,
):
    """Create a new sales Lead. `name` is the lead/contact person's name
    (required — maps to ERPNext's `lead_name` field). Use for requests
    like 'create a lead for Rahul Sharma at ABC Industries' or 'add a new
    lead, source Website'."""

    def run():
        data = _payload(
            lead_name=name,
            email_id=email,
            mobile_no=phone,
            company_name=company,
            status=status,
            source=source,
            territory=territory,
        )
        result = erp_client.create_doc("Lead", data)
        return str(result)

    return _safe_call(f"create lead '{name}'", run)


@tool
def update_lead(
    lead_id: str,
    lead_name: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    company: Optional[str] = None,
    status: Optional[str] = None,
):
    """Update an existing Lead identified by its ID/docname (e.g.
    'CRM-LEAD-2026-00001', depending on your site's Lead naming series).
    Only the fields provided are changed. Use for requests like 'mark
    that lead as Contacted' or 'update the phone number on LEAD-00001'."""

    def run():
        data = _payload(
            lead_name=lead_name,
            email_id=email,
            mobile_no=phone,
            company_name=company,
            status=status,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Lead", lead_id, data)
        return str(result)

    return _safe_call(f"update lead {lead_id}", run)


# ---------------------------------------------------------------------
# Customer (+ a linked Contact for email/mobile — the standard ERPNext way)
# ---------------------------------------------------------------------

@tool
def create_customer(
    customer_name: str,
    customer_type: Optional[str] = None,
    customer_group: Optional[str] = None,
    territory: Optional[str] = None,
    email_id: Optional[str] = None,
    mobile_no: Optional[str] = None,
    lead_id: Optional[str] = None,
):
    """Create a new Customer. `customer_name` is required (e.g. 'ABC
    Industries'). `customer_group` and `territory` fall back to your
    ERPNext site's configured defaults if not given. Pass `lead_id` to
    link it back to the Lead it was converted from. If `email_id` or
    `mobile_no` is given, a linked Contact is also created, since
    ERPNext stores contact details on Contact rather than on Customer
    itself."""

    def run():
        customer_data = _payload(
            customer_name=customer_name,
            customer_type=customer_type,
            customer_group=customer_group,
            territory=territory,
            lead_name=lead_id,
        )
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


@tool
def update_customer(
    customer_id: str,
    customer_name: Optional[str] = None,
    customer_type: Optional[str] = None,
    customer_group: Optional[str] = None,
    territory: Optional[str] = None,
):
    """Update an existing Customer identified by its ID (in stock
    ERPNext this is usually the customer_name itself, e.g. 'ABC
    Industries', unless your site uses a naming series). Only the fields
    provided are changed. Use for requests like 'move ABC Industries to
    the North territory'."""

    def run():
        data = _payload(
            customer_name=customer_name,
            customer_type=customer_type,
            customer_group=customer_group,
            territory=territory,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Customer", customer_id, data)
        return str(result)

    return _safe_call(f"update customer {customer_id}", run)


# ---------------------------------------------------------------------
# Opportunity
# ---------------------------------------------------------------------

@tool
def create_opportunity(
    party_name: str,
    opportunity_from: Optional[str] = None,
    opportunity_amount: Optional[float] = None,
    sales_stage: Optional[str] = None,
    expected_closing: Optional[str] = None,
    probability: Optional[float] = None,
    source: Optional[str] = None,
    contact_email: Optional[str] = None,
    contact_mobile: Optional[str] = None,
):
    """Create a new Opportunity, usually from a qualified Lead or an
    existing Customer. `party_name` is that Lead's or Customer's ID
    (required). `opportunity_from` should be 'Lead' or 'Customer'
    (defaults to 'Customer' if not given). `expected_closing` should be
    YYYY-MM-DD. Use for requests like 'create an opportunity for ABC
    Industries, expected revenue 500000'."""

    def run():
        data = _payload(
            party_name=party_name,
            opportunity_from=opportunity_from or "Customer",
            opportunity_amount=opportunity_amount,
            sales_stage=sales_stage,
            expected_closing=expected_closing,
            probability=probability,
            source=source,
            contact_email=contact_email,
            contact_mobile=contact_mobile,
        )
        result = erp_client.create_doc("Opportunity", data)
        return str(result)

    return _safe_call(f"create opportunity for {party_name}", run)


@tool
def update_opportunity(
    opportunity_id: str,
    opportunity_amount: Optional[float] = None,
    sales_stage: Optional[str] = None,
    expected_closing: Optional[str] = None,
    probability: Optional[float] = None,
    status: Optional[str] = None,
):
    """Update an existing Opportunity identified by its ID (e.g.
    'OPTY-00001'). Only the fields provided are changed. Use for
    requests like 'move OPTY-00001 to the Negotiation stage' or 'update
    the expected revenue on that opportunity to 600000'."""

    def run():
        data = _payload(
            opportunity_amount=opportunity_amount,
            sales_stage=sales_stage,
            expected_closing=expected_closing,
            probability=probability,
            status=status,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Opportunity", opportunity_id, data)
        return str(result)

    return _safe_call(f"update opportunity {opportunity_id}", run)


# ---------------------------------------------------------------------
# Quotation
# ---------------------------------------------------------------------

@tool
def create_quotation(
    customer: str,
    items: list,
    valid_till: Optional[str] = None,
    order_type: Optional[str] = None,
):
    """Create a new Quotation for a customer. `customer` is the Customer
    ID (e.g. 'ABC Industries'). `items` is a list of line items, each a
    dict like {"item_code": "ITEM-001", "qty": 50, "rate": 1200} — at
    least one item is required. Use for requests like 'create a
    quotation for ABC Industries, 50 units of ITEM-001 at 1200 each'.
    `valid_till` should be YYYY-MM-DD."""

    def run():
        data = _payload(
            quotation_to="Customer",
            party_name=customer,
            transaction_date=date.today().isoformat(),
            items=items,
            valid_till=valid_till,
            order_type=order_type or "Sales",
        )
        result = erp_client.create_doc("Quotation", data)
        return str(result)

    return _safe_call(f"create quotation for {customer}", run)


@tool
def update_quotation(
    quotation_id: str,
    items: Optional[list] = None,
    valid_till: Optional[str] = None,
    status: Optional[str] = None,
):
    """Update an existing DRAFT Quotation identified by its ID (e.g.
    'QTN-00001'). Only the fields provided are changed — passing `items`
    replaces the existing item set rather than merging with it. Only
    works while the quotation is still a draft (docstatus 0)."""

    def run():
        data = _payload(items=items, valid_till=valid_till, status=status)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Quotation", quotation_id, data)
        return str(result)

    return _safe_call(f"update quotation {quotation_id}", run)


# ---------------------------------------------------------------------
# Sales Order
# ---------------------------------------------------------------------

@tool
def create_sales_order(
    customer: str,
    items: list,
    delivery_date: Optional[str] = None,
    order_type: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Sales Order for a customer. `customer` is the
    Customer ID. `items` is a list of line items, each a dict like
    {"item_code": "ITEM-001", "qty": 50, "rate": 1200, "uom": "Nos",
    "warehouse": "Stores - CO"} — at least one item is required. Set
    `submit` true to submit the order immediately (via ERPNext's core
    frappe.client.submit) rather than leave it as a draft.
    `delivery_date` should be YYYY-MM-DD. Use for requests like 'create
    a sales order for ABC Industries for 50 units of ITEM-001'."""

    def run():
        data = _payload(
            customer=customer,
            transaction_date=date.today().isoformat(),
            delivery_date=delivery_date or date.today().isoformat(),
            items=items,
            order_type=order_type or "Sales",
        )
        result = erp_client.create_doc("Sales Order", data)

        if submit:
            order_id = result.get("name")
            try:
                result = erp_client.submit_doc("Sales Order", order_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create sales order for {customer}", run)


@tool
def update_sales_order(
    sales_order_id: str,
    items: Optional[list] = None,
    delivery_date: Optional[str] = None,
):
    """Update an existing DRAFT Sales Order identified by its ID (e.g.
    'SO-00001'). Only the fields provided are changed — passing `items`
    replaces the existing item set rather than merging with it. Only
    edits a draft order (docstatus 0); a submitted order needs a
    separate amendment, not a plain update."""

    def run():
        data = _payload(items=items, delivery_date=delivery_date)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Sales Order", sales_order_id, data)
        return str(result)

    return _safe_call(f"update sales order {sales_order_id}", run)


SALES_WRITE_TOOLS = [
    create_lead,
    update_lead,
    create_customer,
    update_customer,
    create_opportunity,
    update_opportunity,
    create_quotation,
    update_quotation,
    create_sales_order,
    update_sales_order,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
#
# Each entry: tool_name -> ordered list of (field_name, question) pairs.
# Only fields that are genuinely mandatory in stock ERPNext (or that a
# write is meaningless without) are listed here — everything else stays
# optional and is simply omitted if the user never mentions it.
REQUIRED_FIELDS = {
    "create_lead": [
        ("name", "What's the lead's name?"),
    ],
    "update_lead": [
        ("lead_id", "Which lead should I update? (its ID/docname)"),
    ],
    "create_customer": [
        ("customer_name", "What's the customer or company name?"),
    ],
    "update_customer": [
        ("customer_id", "Which customer should I update?"),
    ],
    "create_opportunity": [
        ("party_name", "Which Lead or Customer is this opportunity for?"),
    ],
    "update_opportunity": [
        ("opportunity_id", "Which opportunity should I update? (e.g. OPTY-00001)"),
    ],
    "create_quotation": [
        ("customer", "Which customer is this quotation for?"),
        (
            "items",
            "What items should be on the quotation? Give each as "
            "'item code, quantity, rate' — separate multiple items with a "
            "semicolon, e.g. 'ITEM-001, 50, 1200; ITEM-002, 10, 500'.",
        ),
    ],
    "update_quotation": [
        ("quotation_id", "Which quotation should I update? (e.g. QTN-00001)"),
    ],
    "create_sales_order": [
        ("customer", "Which customer is this sales order for?"),
        (
            "items",
            "What items should be on the order? Give each as "
            "'item code, quantity, rate' — separate multiple items with a "
            "semicolon, e.g. 'ITEM-001, 50, 1200; ITEM-002, 10, 500'.",
        ),
    ],
    "update_sales_order": [
        ("sales_order_id", "Which sales order should I update? (e.g. SO-00001)"),
    ],
}


def _parse_items_answer(text: str) -> list:
    """Parses a free-text answer to an 'items' slot-filling question into
    the list-of-dicts shape create_quotation/create_sales_order expect.

    Expected format per item: 'item code, quantity, rate' (rate optional),
    multiple items separated by semicolons, e.g.
    'ITEM-001, 50, 1200; ITEM-002, 10, 500'. Falls back to leaving a value
    as a plain string if it isn't numeric, rather than dropping it, so a
    malformed number doesn't silently disappear.
    """

    def _num(value):
        value = value.strip()
        try:
            return float(value) if "." in value else int(value)
        except ValueError:
            return value

    items = []
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split(",") if p.strip()]
        if not parts:
            continue

        entry = {"item_code": parts[0]}
        if len(parts) >= 2:
            entry["qty"] = _num(parts[1])
        if len(parts) >= 3:
            entry["rate"] = _num(parts[2])
        items.append(entry)

    return items


# Per-(tool, field) parsers for slot-filling answers that need to become
# something other than a plain string before being passed to the tool
# (e.g. `items` must be a list of dicts, not raw text). Any (tool, field)
# pair not listed here is stored as the user's raw, trimmed text.
FIELD_PARSERS = {
    ("create_quotation", "items"): _parse_items_answer,
    ("create_sales_order", "items"): _parse_items_answer,
}