"""
ERP/tools/crm_conversion_tools.py

Moving a Lead/Opportunity to the next sales-pipeline stage was being done
via erp_data_tool's generic create -- manually guessing field mappings
turn by turn (e.g. using a Lead's own ID as a Customer's name). ERPNext
already has purpose-built, whitelisted conversion methods for every one of
these transitions (Lead.make_customer, Lead.make_opportunity,
Lead.make_quotation, Opportunity.make_quotation, Opportunity.make_customer,
Quotation.make_sales_order) that correctly map every field and link any
existing address/contact -- this tool calls the real one instead of
reinventing the mapping.
"""

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.dynamic_fields import (
    apply_default_values,
    missing_required_fields,
    field_question,
    explain_erp_error,
    safe_call as _safe_call,
)

_CONVERSIONS = {
    ("Lead", "Customer"): "erpnext.crm.doctype.lead.lead.make_customer",
    ("Lead", "Opportunity"): "erpnext.crm.doctype.lead.lead.make_opportunity",
    ("Lead", "Quotation"): "erpnext.crm.doctype.lead.lead.make_quotation",
    ("Opportunity", "Customer"): "erpnext.crm.doctype.opportunity.opportunity.make_customer",
    ("Opportunity", "Quotation"): "erpnext.crm.doctype.opportunity.opportunity.make_quotation",
    ("Quotation", "Sales Order"): "erpnext.selling.doctype.quotation.quotation.make_sales_order",
}

# Bookkeeping fields Frappe attaches to a freshly mapped (not-yet-saved) doc
# that aren't real data and would confuse a create call sent back as-is.
_STRIP_FIELDS = {
    "doctype", "name", "owner", "creation", "modified", "modified_by",
    "docstatus", "idx", "__islocal", "__unsaved", "parent", "parentfield", "parenttype",
}


def _clean_mapped_doc(mapped: dict) -> dict:
    cleaned = {}
    for k, v in (mapped or {}).items():
        if k in _STRIP_FIELDS or k.startswith("_"):
            continue
        if v in (None, "", [], {}):
            continue
        cleaned[k] = v
    return cleaned


@tool
def convert_crm_record(
    source_doctype: str,
    source_name: str,
    target_doctype: str,
    dry_run: bool = True,
) -> str:
    """Converts an existing Lead/Opportunity/Quotation to the next stage in
    the sales pipeline using ERPNext's OWN built-in conversion -- not a
    manual guess at field mapping. Use this instead of erp_data_tool's
    generic create whenever moving a record to the next pipeline stage; it
    correctly maps fields (e.g. a Lead's company_name becomes the
    Customer's customer_name, never the Lead's own ID) and links any
    existing address/contact automatically.

    Supported (source_doctype, target_doctype) pairs:
      - Lead -> Customer, Lead -> Opportunity, Lead -> Quotation
      - Opportunity -> Customer, Opportunity -> Quotation
      - Quotation -> Sales Order

    `source_name` is the exact document ID of the source record (e.g.
    'CRM-LEAD-2026-00015').

    IMPORTANT: `dry_run` defaults to True. A dry run fetches ERPNext's own
    field mapping and shows it for review WITHOUT creating anything. Only
    call again with dry_run=False, after explicit user confirmation, to
    actually create the record.

    The dry run's `naming_series` line (e.g. 'CUST-.YYYY.-') is only a
    template, not the record's ID -- some doctypes name records by that
    series, others by their title instead. Once the real (dry_run=False)
    call returns, its `name` field is the exact, final ID -- use that
    value in any later tool call, never one guessed from the series."""

    src = source_doctype.strip().title()
    tgt = "Sales Order" if target_doctype.strip().lower() == "sales order" else target_doctype.strip().title()
    method = _CONVERSIONS.get((src, tgt))
    if not method:
        supported = ", ".join(f"{a} -> {b}" for a, b in _CONVERSIONS)
        return f"No built-in conversion from {source_doctype} to {target_doctype}. Supported: {supported}."

    try:
        mapped = erp_client.call_method_post(method, {"source_name": source_name})
    except Exception as exc:  # noqa: BLE001
        return explain_erp_error(exc, context=f"convert {src} '{source_name}' to {tgt}")

    data = _clean_mapped_doc(mapped)

    if dry_run:
        lines = [
            f"DRY RUN -- nothing created yet. MagnaERP's own mapping for "
            f"{src} '{source_name}' -> {tgt}:", "",
        ]
        for k, v in data.items():
            lines.append(f"- {k}: {v}")
        lines.append("")
        lines.append(
            f"Call this again with dry_run=False (after confirming with the "
            f"user) to actually create the {tgt}."
        )
        return "\n".join(lines)

    # ERPNext's own mapping usually satisfies every required field already
    # (that's the whole point of using it) -- but fill in anything still
    # missing via the same schema-driven defaults the rest of the create
    # flow uses, and ask rather than let the write fail with a raw error.
    data = apply_default_values(tgt, data)
    missing = missing_required_fields(tgt, data)
    if missing:
        labels = ", ".join(f"{f['label']} ({f['fieldname']})" for f in missing)
        return (
            f"MagnaERP's own mapping is missing required field(s) for {tgt}: "
            f"{labels}. {field_question(missing[0])} Once you have the answer, "
            f"include it and call this tool again with dry_run=False."
        )

    def do_create():
        return erp_client.create_doc(tgt, data)

    return str(_safe_call(f"create {tgt} from {src} '{source_name}'", do_create))


CRM_CONVERSION_TOOLS = [convert_crm_record]
