"""
ERP/tools/sales_write_tools.py

Create/update tools for the agent, backed by the custom "sales_app"
whitelisted-method API (see Sales App API Reference / Sales Module API
Documentation) rather than the generic ERPNext doctype REST resource that
sales_tools.py's read-only tools use. All of these hit
POST /api/method/sales_app.api.<module>.<action> via
erp_client.call_method_post().

Same conventions as sales_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — failures are caught and turned into a short string the
    LLM can relay honestly.
  - optional args are typed Optional[...] = None and resolved inside the
    function body (see _default in sales_tools.py) so small local models
    passing explicit `null` don't trip Pydantic validation.

Add this list to ERP/tools/__init__.py:
    from .sales_write_tools import SALES_WRITE_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS]
"""

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
    job_title: Optional[str] = None,
    status: Optional[str] = None,
    lead_source: Optional[str] = None,
    industry: Optional[str] = None,
    product_interested: Optional[str] = None,
    quantity: Optional[str] = None,
    notes: Optional[str] = None,
    territory: Optional[str] = None,
    target_delivery_date: Optional[str] = None,
):
    """Create a new sales Lead. `name` is the lead/contact person's name
    (required). Use for requests like 'create a lead for Rahul Sharma at
    ABC Industries' or 'add a new lead, interested in ITEM-001, qty 100'.
    Dates should be in YYYY-MM-DD format."""

    def run():
        data = _payload(
            name=name,
            email=email,
            phone=phone,
            company=company,
            job_title=job_title,
            status=status,
            lead_source=lead_source,
            industry=industry,
            product_interested=product_interested,
            quantity=quantity,
            notes=notes,
            territory=territory,
            target_delivery_date=target_delivery_date,
        )
        result = erp_client.call_method_post("sales_app.api.lead.create_lead", data)
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
    product_interested: Optional[str] = None,
    quantity: Optional[str] = None,
    notes: Optional[str] = None,
):
    """Update an existing Lead identified by its ID (e.g. 'LEAD-00001').
    Only the fields provided are changed. Use for requests like 'mark
    LEAD-00001 as Contacted', 'update the phone number on that lead', or
    'change the quantity to 50 on LEAD-00001'."""

    def run():
        data = _payload(
            name=lead_id,
            lead_name=lead_name,
            email=email,
            phone=phone,
            company=company,
            status=status,
            product_interested=product_interested,
            quantity=quantity,
            notes=notes,
        )
        result = erp_client.call_method_post("sales_app.api.lead.update_lead", data)
        return str(result)

    return _safe_call(f"update lead {lead_id}", run)


# ---------------------------------------------------------------------
# Customer
# ---------------------------------------------------------------------

@tool
def create_customer(
    customer_name: str,
    customer_type: Optional[str] = None,
    customer_group: Optional[str] = None,
    territory: Optional[str] = None,
    email_id: Optional[str] = None,
    mobile_no: Optional[str] = None,
    website: Optional[str] = None,
    payment_terms: Optional[str] = None,
    credit_limit: Optional[float] = None,
    address_line1: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    pincode: Optional[str] = None,
    country: Optional[str] = None,
    lead_id: Optional[str] = None,
):
    """Create a new Customer. `customer_name` is required (e.g. 'ABC
    Industries'). Use for requests like 'create a customer called ABC
    Industries in Pune' or 'add this lead as a customer'. Pass `lead_id`
    to link it back to the Lead it was converted from."""

    def run():
        data = _payload(
            customer_name=customer_name,
            customer_type=customer_type,
            customer_group=customer_group,
            territory=territory,
            email_id=email_id,
            mobile_no=mobile_no,
            website=website,
            payment_terms=payment_terms,
            credit_limit=credit_limit,
            address_line1=address_line1,
            city=city,
            state=state,
            pincode=pincode,
            country=country,
            lead_id=lead_id,
        )
        result = erp_client.call_method_post("sales_app.api.customer.create_customer", data)
        return str(result)

    return _safe_call(f"create customer '{customer_name}'", run)


@tool
def update_customer(
    customer_id: str,
    customer_name: Optional[str] = None,
    customer_type: Optional[str] = None,
    customer_group: Optional[str] = None,
    territory: Optional[str] = None,
    email_id: Optional[str] = None,
    mobile_no: Optional[str] = None,
    payment_terms: Optional[str] = None,
    credit_limit: Optional[float] = None,
    address_line1: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    pincode: Optional[str] = None,
):
    """Update an existing Customer identified by its ID (e.g.
    'CUST-0001'). Only the fields provided are changed. Use for requests
    like 'update the credit limit for CUST-0001 to 1500000' or 'change
    ABC Industries' payment terms to Net 45'."""

    def run():
        data = _payload(
            name=customer_id,
            customer_name=customer_name,
            customer_type=customer_type,
            customer_group=customer_group,
            territory=territory,
            email_id=email_id,
            mobile_no=mobile_no,
            payment_terms=payment_terms,
            credit_limit=credit_limit,
            address_line1=address_line1,
            city=city,
            state=state,
            pincode=pincode,
        )
        result = erp_client.call_method_post("sales_app.api.customer.update_customer", data)
        return str(result)

    return _safe_call(f"update customer {customer_id}", run)


# ---------------------------------------------------------------------
# Opportunity
# ---------------------------------------------------------------------

@tool
def create_opportunity(
    lead: Optional[str] = None,
    opportunity_name: Optional[str] = None,
    expected_revenue: Optional[float] = None,
    probability: Optional[float] = None,
    close_date: Optional[str] = None,
    stage: Optional[str] = None,
    source: Optional[str] = None,
    contact_email: Optional[str] = None,
    contact_mobile: Optional[str] = None,
    product_code: Optional[str] = None,
    quantity: Optional[float] = None,
    required_delivery_timeline: Optional[str] = None,
    notes: Optional[str] = None,
):
    """Create a new Opportunity, usually from a qualified Lead. Use for
    requests like 'create an opportunity for LEAD-00001, expected
    revenue 500000' or 'open a new opportunity in the Discussion stage'.
    `close_date` should be YYYY-MM-DD."""

    def run():
        data = _payload(
            lead=lead,
            opportunity_name=opportunity_name,
            expected_revenue=expected_revenue,
            probability=probability,
            close_date=close_date,
            stage=stage,
            source=source,
            contact_email=contact_email,
            contact_mobile=contact_mobile,
            product_code=product_code,
            quantity=quantity,
            required_delivery_timeline=required_delivery_timeline,
            notes=notes,
        )
        result = erp_client.call_method_post("sales_app.api.opportunity.create_opportunity", data)
        return str(result)

    return _safe_call("create opportunity", run)


@tool
def update_opportunity(
    opportunity_id: str,
    opportunity_name: Optional[str] = None,
    expected_revenue: Optional[float] = None,
    probability: Optional[float] = None,
    close_date: Optional[str] = None,
    stage: Optional[str] = None,
    status: Optional[str] = None,
    quantity: Optional[float] = None,
    required_delivery_timeline: Optional[str] = None,
    notes: Optional[str] = None,
):
    """Update an existing Opportunity identified by its ID (e.g.
    'OPP-00001'). Only the fields provided are changed. Use for requests
    like 'move OPP-00001 to Negotiation stage' or 'update the expected
    revenue on that opportunity to 600000'. For a bare stage change on
    the Pipeline board, prefer a dedicated stage-update tool if one is
    registered; this tool works for that too via `stage`."""

    def run():
        data = _payload(
            name=opportunity_id,
            opportunity_name=opportunity_name,
            expected_revenue=expected_revenue,
            probability=probability,
            close_date=close_date,
            stage=stage,
            status=status,
            quantity=quantity,
            required_delivery_timeline=required_delivery_timeline,
            notes=notes,
        )
        result = erp_client.call_method_post("sales_app.api.opportunity.update_opportunity", data)
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
    discount_percent: Optional[float] = None,
    apply_discount_on: Optional[str] = None,
    tentative_delivery_date: Optional[str] = None,
    note: Optional[str] = None,
    fulfilment_plant: Optional[str] = None,
):
    """Create a new Quotation for a customer. `customer` is the customer
    ID (e.g. 'CUST-0001'). `items` is a list of line items, each a dict
    like {"item_code": "ITEM-001", "qty": 50, "rate": 1200,
    "description": "Steel Bracket"} — at least one item is required. Use
    for requests like 'create a quotation for CUST-0001, 50 units of
    ITEM-001 at 1200 each'. Dates should be YYYY-MM-DD."""

    def run():
        data = _payload(
            customer=customer,
            items=items,
            valid_till=valid_till,
            order_type=order_type,
            discount_percent=discount_percent,
            apply_discount_on=apply_discount_on,
            tentative_delivery_date=tentative_delivery_date,
            note=note,
            fulfilment_plant=fulfilment_plant,
        )
        result = erp_client.call_method_post("sales_app.api.quotation.create_quotation", data)
        return str(result)

    return _safe_call(f"create quotation for {customer}", run)


@tool
def update_quotation(
    quotation_id: str,
    customer: Optional[str] = None,
    items: Optional[list] = None,
    valid_till: Optional[str] = None,
    discount_percent: Optional[float] = None,
    tentative_delivery_date: Optional[str] = None,
    note: Optional[str] = None,
    status: Optional[str] = None,
):
    """Update an existing Quotation identified by its ID (e.g.
    'QTN-00001'). Only the fields provided are changed — pass a full new
    `items` list if line items need to change, since it replaces the
    existing item set rather than merging with it. Use for requests like
    'update QTN-00001's discount to 10%' or 'change the delivery date on
    that quotation'."""

    def run():
        data = _payload(
            name=quotation_id,
            customer=customer,
            items=items,
            valid_till=valid_till,
            discount_percent=discount_percent,
            tentative_delivery_date=tentative_delivery_date,
            note=note,
            status=status,
        )
        result = erp_client.call_method_post("sales_app.api.quotation.update_quotation", data)
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
    note: Optional[str] = None,
    priority: Optional[str] = None,
    submit: Optional[bool] = None,
    create_work_order: Optional[bool] = None,
):
    """Create a new Sales Order for a customer. `customer` is the
    customer ID (e.g. 'CUST-0001'). `items` is a list of line items,
    each a dict like {"item_code": "ITEM-001", "qty": 50, "rate": 1200,
    "uom": "Nos", "warehouse": "Stores - CO"} — at least one item is
    required. Set `submit` true to submit the order immediately rather
    than leave it as a draft, and `create_work_order` true if a
    manufacturing Work Order should be raised for it. Use for requests
    like 'create a sales order for CUST-0001 for 50 units of ITEM-001'.
    `delivery_date` should be YYYY-MM-DD."""

    def run():
        data = _payload(
            customer=customer,
            items=items,
            delivery_date=delivery_date,
            order_type=order_type,
            note=note,
            priority=priority,
            submit=(1 if submit else (0 if submit is not None else None)),
            create_work_order=(1 if create_work_order else (0 if create_work_order is not None else None)),
        )
        result = erp_client.call_method_post("sales_app.api.sales_order.create_sales_order", data)
        return str(result)

    return _safe_call(f"create sales order for {customer}", run)


@tool
def update_sales_order(
    sales_order_id: str,
    customer: Optional[str] = None,
    items: Optional[list] = None,
    delivery_date: Optional[str] = None,
    note: Optional[str] = None,
):
    """Update an existing Sales Order identified by its ID (e.g.
    'SO-00001'). Only the fields provided are changed — pass a full new
    `items` list if line items need to change, since it replaces the
    existing item set rather than merging with it. Use for requests like
    'push the delivery date on SO-00001 to next month' or 'update the
    note on that sales order'. Note: this only edits a draft order —
    submitting, cancelling, or converting an order into a delivery note
    or invoice needs a separate action."""

    def run():
        data = _payload(
            name=sales_order_id,
            customer=customer,
            items=items,
            delivery_date=delivery_date,
            note=note,
        )
        result = erp_client.call_method_post("sales_app.api.sales_order.update_sales_order", data)
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
