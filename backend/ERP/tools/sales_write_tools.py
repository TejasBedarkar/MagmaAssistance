from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _safe_call(label, fn):
    
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _payload(**kwargs):
   
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