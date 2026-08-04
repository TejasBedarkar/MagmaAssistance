"""Read-only list/count tools for all MagnaERP modules exposed by the agent."""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _list_records(label, doctype, fields, limit=20, filters=None, order_by=None):
    try:
        rows = erp_client.get_list(
            doctype, fields=fields, filters=filters, order_by=order_by, limit=limit,
        )
    except Exception as exc:  # noqa: BLE001
        return f"Could not fetch {label.lower()} from MagnaERP right now ({exc})."
    if not rows:
        return f"{label} found: 0."
    return f"{label} found: {len(rows)}.\n" + "\n".join(
        f"- " + " — ".join(str(row.get(field)) for field in fields if row.get(field) not in (None, ""))
        for row in rows
    )


@tool
def get_sales_orders(limit: int = 20, customer: Optional[str] = None) -> str:
    """List and count Sales Orders in all statuses, optionally for a customer."""
    filters = [["customer", "=", customer]] if customer else None
    return _list_records("Sales Orders", "Sales Order", ["name", "customer", "transaction_date", "grand_total", "status"], limit, filters, "transaction_date desc")


@tool
def get_sales_invoices(limit: int = 20, customer: Optional[str] = None) -> str:
    """List and count Sales Invoices in all statuses, optionally for a customer."""
    filters = [["customer", "=", customer]] if customer else None
    return _list_records("Sales Invoices", "Sales Invoice", ["name", "customer", "posting_date", "grand_total", "outstanding_amount", "status"], limit, filters, "posting_date desc")


@tool
def get_quotations(limit: int = 20, customer: Optional[str] = None) -> str:
    """List and count Quotations in all statuses, optionally for a customer."""
    filters = [["party_name", "=", customer]] if customer else None
    return _list_records("Quotations", "Quotation", ["name", "party_name", "transaction_date", "grand_total", "status"], limit, filters, "transaction_date desc")


@tool
def get_opportunities(limit: int = 20, party_name: Optional[str] = None) -> str:
    """List and count Opportunities, optionally for a Lead or Customer."""
    filters = [["party_name", "=", party_name]] if party_name else None
    return _list_records("Opportunities", "Opportunity", ["name", "party_name", "opportunity_from", "sales_stage", "opportunity_amount", "status"], limit, filters, "creation desc")


@tool
def get_leads(limit: int = 20, status: Optional[str] = None) -> str:
    """List and count Leads, optionally filtered by status."""
    filters = [["status", "=", status]] if status else None
    return _list_records("Leads", "Lead", ["name", "lead_name", "company_name", "status", "email_id", "mobile_no"], limit, filters, "creation desc")


@tool
def get_customers(limit: int = 20) -> str:
    """List and count all Customers with their IDs and basic details."""
    return _list_records("Customers", "Customer", ["name", "customer_name", "customer_group", "territory"], limit, order_by="customer_name asc")


@tool
def get_suppliers(limit: int = 20) -> str:
    """List and count all Suppliers with their IDs and basic details."""
    return _list_records("Suppliers", "Supplier", ["name", "supplier_name", "supplier_group", "supplier_type", "country"], limit, order_by="supplier_name asc")


@tool
def get_material_requests(limit: int = 20, status: Optional[str] = None) -> str:
    """List and count Material Requests in all statuses, optionally filtered by status."""
    filters = [["status", "=", status]] if status else None
    return _list_records("Material Requests", "Material Request", ["name", "material_request_type", "transaction_date", "schedule_date", "status"], limit, filters, "transaction_date desc")


@tool
def get_stock_entries(limit: int = 20, stock_entry_type: Optional[str] = None) -> str:
    """List and count stock movements (Stock Entries), optionally by movement type."""
    filters = [["stock_entry_type", "=", stock_entry_type]] if stock_entry_type else None
    return _list_records("Stock Movements", "Stock Entry", ["name", "stock_entry_type", "posting_date", "from_warehouse", "to_warehouse", "docstatus"], limit, filters, "posting_date desc")


@tool
def get_employees(limit: int = 20, status: Optional[str] = None) -> str:
    """List and count Employees, optionally filtered by employment status."""
    filters = [["status", "=", status]] if status else None
    return _list_records("Employees", "Employee", ["name", "employee_name", "department", "designation", "status", "company"], limit, filters, "employee_name asc")


@tool
def get_leave_applications(limit: int = 20, employee: Optional[str] = None) -> str:
    """List and count Leave Applications, optionally for an employee."""
    filters = [["employee", "=", employee]] if employee else None
    return _list_records("Leave Applications", "Leave Application", ["name", "employee", "leave_type", "from_date", "to_date", "status"], limit, filters, "from_date desc")


@tool
def get_attendance(limit: int = 20, employee: Optional[str] = None) -> str:
    """List and count Attendance records, optionally for an employee."""
    filters = [["employee", "=", employee]] if employee else None
    return _list_records("Attendance Records", "Attendance", ["name", "employee", "attendance_date", "status", "company"], limit, filters, "attendance_date desc")


@tool
def get_payment_entries(limit: int = 20, party: Optional[str] = None) -> str:
    """List and count Payment Entries, optionally for a customer or supplier."""
    filters = [["party", "=", party]] if party else None
    return _list_records("Payment Entries", "Payment Entry", ["name", "payment_type", "party_type", "party", "posting_date", "paid_amount", "status"], limit, filters, "posting_date desc")


@tool
def get_journal_entries(limit: int = 20) -> str:
    """List and count Journal Entries with posting date, type, amount, and status."""
    return _list_records("Journal Entries", "Journal Entry", ["name", "voucher_type", "posting_date", "total_debit", "total_credit", "docstatus"], limit, order_by="posting_date desc")


MODULE_READ_TOOLS = [
    get_sales_orders,
    get_sales_invoices,
    get_quotations,
    get_opportunities,
    get_leads,
    get_customers,
    get_suppliers,
    get_material_requests,
    get_stock_entries,
    get_employees,
    get_leave_applications,
    get_attendance,
    get_payment_entries,
    get_journal_entries,
]
