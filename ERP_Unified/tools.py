"""
ERP_Unified/tools.py

Single generic gateway to ERPNext (`erp_data_tool`) for ANY doctype,
instead of one hand-written tool per doctype/action (that's the
`ERP/tools/*` approach). Unlike that approach, this one can't rely on a
hand-maintained REQUIRED_FIELDS list per tool (see
ERP/tools/sales_write_tools.py) — a single tool covering every doctype
has no way to know ahead of time which fields 'Lead' vs 'Sales Order'
vs some custom doctype need.

So field discovery here is DYNAMIC instead: `create` calls read the
doctype's live schema straight from ERPNext (via
ERP.dynamic_fields.get_required_fields(), backed by
erp_client.get_meta()) to figure out what's mandatory, and — if
anything required is still missing from `data` — respond with exactly
ONE question for the next missing field rather than a flat error. This
lets the calling agent ask the user one field at a time, add each
answer to `data` under the field's ERPNext fieldname, and re-call this
tool with `session_id` unchanged until every required field is filled
and the record actually gets created.

Any exception from ERPNext (missing field, bad link value, duplicate
record, permission problem, ERPNext unreachable, etc.) is turned into a
plain-language explanation via ERP.dynamic_fields.explain_erp_error()
instead of a raw Python/HTTP error string, so the user always gets a
sentence they can act on rather than a stack trace.
"""

import re
from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.dynamic_fields import (
    missing_required_fields,
    field_question,
    explain_erp_error,
    apply_default_values,
    safe_call as _safe_call,
)
from ERP.tools.project_onboarding_tools import PROJECT_ONBOARDING_TOOLS

BLOCKED_OPERATIONS = {"delete", "remove", "trash", "destroy", "cancel", "purge", "drop"}
LIST_OPERATIONS = {"list", "get_list", "search", "find", "query"}
GET_OPERATIONS = {"get", "get_doc", "fetch", "detail", "details", "view"}
CREATE_OPERATIONS = {"create", "insert", "add", "new"}
UPDATE_OPERATIONS = {"update", "edit", "modify", "set"}
SUBMIT_OPERATIONS = {"submit"}

# In-memory store of in-progress creates, keyed by (session_id, doctype),
# so a create that's missing fields can be resumed across multiple tool
# calls without the caller having to resend everything collected so far.
# This is the same "ask one field at a time, remember the answers"
# pattern ERP/server.py implements for the per-domain tools via
# task_slots/pending_tool — reimplemented locally here since this
# module isn't wired into that LangGraph state machine (see README.md).
# A restart of the process clears it, same tradeoff as server.py's
# in-memory MemorySaver checkpointer.
_PENDING_CREATES: dict[tuple, dict] = {}

# Web-derived values are useful suggestions, not authority to write to the
# ERP. Keep the review requirement alongside the pending create payload so a
# user must explicitly approve the final assembled record before it is sent.
_PENDING_WEB_REVIEWS: set[tuple] = set()


def pending_web_review_doctype(session_id: str) -> Optional[str]:
    """Return the one reviewed record awaiting this session's approval.

    The chat server uses this to turn an ordinary human reply such as
    ``yes, create it`` into a deterministic approved create call instead of
    relying on the model to reconstruct tool arguments.
    """
    pending = [doctype for review_session, doctype in _PENDING_WEB_REVIEWS if review_session == session_id]
    return pending[0] if len(pending) == 1 else None


_EMAIL_RE = re.compile(
    r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+"
    r"[A-Z]{2,63}$",
    re.IGNORECASE,
)


def _is_valid_email(value) -> bool:
    if not isinstance(value, str):
        return False
    email = value.strip()
    return bool(email and len(email) <= 254 and ".." not in email and _EMAIL_RE.fullmatch(email))


def _resolve_link_value(target_doctype: str, value) -> str | None:
    """Return the exact ERPNext document name (ID) if it exists, matching exactly or fuzzy."""
    if value in (None, ""):
        return None
        
    value_str = str(value)
    
    # 1. Try exact match on 'name'
    matches = erp_client.get_list(
        target_doctype,
        fields=["name"],
        filters=[["name", "=", value_str]],
        limit=1,
        use_cache=False,
    )
    if matches:
        return matches[0]["name"]
        
    # 2. Try fuzzy lookup using common search fields
    try:
        meta = erp_client.get_meta(target_doctype)
        title_field = meta.get("title_field")
        search_fields = [sf.strip() for sf in (meta.get("search_fields") or "").split(",") if sf.strip()]
        
        fields_to_search = set()
        if title_field:
            fields_to_search.add(title_field)
        fields_to_search.update(search_fields)
        
        # Fallback to common naming fields
        common = {
            f"{target_doctype.lower()}_name", "title", "company_name", 
            "first_name", "full_name", "party_name", "customer_name", "lead_name"
        }
        meta_fields = {f.get("fieldname") for f in meta.get("fields", []) if f.get("fieldname")}
        fields_to_search.update(common.intersection(meta_fields))
        fields_to_search.add("name")
        
        or_filters = [[f, "like", f"%{value_str}%"] for f in fields_to_search]
        
        fuzzy_matches = erp_client.get_list(
            target_doctype,
            fields=["name"],
            or_filters=or_filters,
            limit=2,
            use_cache=False,
        )
        # Only auto-resolve if exactly ONE record matches the fuzzy search
        if len(fuzzy_matches) == 1:
            return fuzzy_matches[0]["name"]
    except Exception:
        pass # Ignore meta/fuzzy fetch errors and fall back to None
        
    return None


def _prepare_write_data(doctype: str, data: Optional[dict]) -> tuple[dict, list[str]]:
    """Validate model-produced values against the live ERPNext schema.

    Optional invalid Link/Select values are omitted instead of allowing a
    predictable Frappe validation exception. Required values are also omitted,
    which makes the existing required-field flow ask for a valid replacement.
    Lead.company is special: it means the user's internal ERP company, while a
    researched employer belongs in Lead.company_name.
    """
    cleaned = dict(data or {})
    warnings: list[str] = []
    meta = erp_client.get_meta(doctype)
    fields = {
        field.get("fieldname"): field
        for field in meta.get("fields", []) or []
        if field.get("fieldname")
    }

    if doctype.strip().lower() == "lead" and cleaned.get("company"):
        internal_company = cleaned["company"]
        try:
            resolved_company = _resolve_link_value("Company", internal_company)
        except Exception:  # Let generic validation/ERP expose connection issues.
            resolved_company = internal_company
            
        if not resolved_company:
            cleaned.setdefault("company_name", internal_company)
            cleaned.pop("company", None)
            warnings.append(
                f"Moved '{internal_company}' from company to company_name because "
                "Lead.company only accepts an existing internal ERP Company."
            )

    for fieldname, value in list(cleaned.items()):
        if value in (None, "", [], {}):
            continue
        field = fields.get(fieldname)
        if not field:
            continue

        fieldtype = field.get("fieldtype")
        is_email_field = (
            "email" in fieldname.lower()
            or str(field.get("options") or "").strip().lower() == "email"
        )
        if is_email_field:
            if not _is_valid_email(value):
                cleaned.pop(fieldname, None)
                warnings.append(
                    f"Omitted {fieldname} because '{value}' is not a valid email address."
                )
            else:
                cleaned[fieldname] = value.strip()
            continue

        if fieldtype in ("Date", "Datetime"):
            try:
                from dateutil import parser
                parsed_date = parser.parse(str(value))
                if fieldtype == "Date":
                    cleaned[fieldname] = parsed_date.strftime("%Y-%m-%d")
                else:
                    cleaned[fieldname] = parsed_date.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                cleaned.pop(fieldname, None)
                warnings.append(
                    f"Omitted {fieldname}='{value}' because it could not be recognized as a valid date."
                )
            continue

        if fieldtype in ("Link", "Dynamic Link") and field.get("options"):
            target_doctype = field["options"]
            if fieldtype == "Dynamic Link":
                target_doctype = cleaned.get(field["options"])
                
            if target_doctype:
                try:
                    resolved_id = _resolve_link_value(target_doctype, value)
                except Exception:
                    # Do not disguise authentication/network problems as bad data.
                    raise
                if not resolved_id:
                    cleaned.pop(fieldname, None)
                    warnings.append(
                        f"Omitted {fieldname}='{value}' because no matching "
                        f"{target_doctype} exists in ERPNext."
                    )
                else:
                    cleaned[fieldname] = resolved_id
            elif fieldtype == "Dynamic Link":
                cleaned.pop(fieldname, None)
                warnings.append(
                    f"Omitted {fieldname}='{value}' because its reference field '{field['options']}' was not provided."
                )

        if fieldtype == "Select" and field.get("options"):
            choices = [choice.strip() for choice in str(field["options"]).split("\n") if choice.strip()]
            if choices and str(value) not in choices:
                cleaned.pop(fieldname, None)
                warnings.append(
                    f"Omitted {fieldname}='{value}' because it is not an allowed option."
                )

    return cleaned, warnings


def _with_warnings(message: str, warnings: list[str]) -> str:
    if not warnings:
        return message
    return message + "\nValidation adjustments: " + " ".join(warnings)


_OPERATOR_MAP = {
    "greaterthan": ">",
    "greaterthanorequalto": ">=",
    "greaterthanorequal": ">=",
    "gt": ">",
    "gte": ">=",
    "ge": ">=",
    "lessthan": "<",
    "lessthanorequalto": "<=",
    "lessthanorequal": "<=",
    "lt": "<",
    "lte": "<=",
    "le": "<=",
    "equal": "=",
    "equalto": "=",
    "equals": "=",
    "eq": "=",
    "notequal": "!=",
    "notequalto": "!=",
    "notequals": "!=",
    "neq": "!=",
    "ne": "!=",
}


def _normalize_filters(filters: Optional[list]) -> Optional[list]:
    """Convert natural language comparison operators ('greater than', 'greaterthan', 'less than')
    to standard SQL/Frappe comparison operators ('>', '<', '>=', etc.)."""
    if not filters:
        return filters
    normalized = []
    for f in filters:
        if isinstance(f, (list, tuple)) and len(f) >= 3:
            field, raw_op, val = f[0], str(f[1]), f[2]
            key = raw_op.lower().replace(" ", "").replace("_", "").replace("-", "")
            clean_op = _OPERATOR_MAP.get(key, raw_op)
            normalized.append([field, clean_op, val])
        else:
            normalized.append(f)
    return normalized


@tool
def erp_data_tool(
    operation: str,
    doctype: str,
    name: Optional[str] = None,
    fields: Optional[list] = None,
    filters: Optional[list] = None,
    order_by: Optional[str] = None,
    limit: int = 20,
    data: Optional[dict] = None,
    submit: bool = False,
    session_id: str = "default",
    web_enriched: bool = False,
    approved: Optional[bool] = None,
) -> str:
    """Single generic gateway to ERPNext for ANY doctype, instead of a
    separate tool per doctype/action. `doctype` is the exact ERPNext
    doctype name (e.g. 'Sales Order', 'Customer', 'Lead', 'Item',
    'Quotation', 'Purchase Order', 'Employee', 'Journal Entry', etc).

    `operation` selects the action:
      - 'list'   : list/search records. Use `fields` (list of field
                   names), `filters` (ERPNext filter format, e.g.
                   [["status", "=", "Open"]], [["transaction_date", ">=", "2026-01-01"]]),
                   `order_by`, and `limit`. Note: Always use standard operators ('>=', '>', '<=', '<', '=', '!=') in filters.
      - 'get'    : fetch one full record by `name` (the document ID).
      - 'create' : create a new record. Pass whatever fields the user
                   has already given in `data` (can be partial or
                   omitted entirely) — this tool checks ERPNext's LIVE
                   schema for what's actually required on `doctype` and,
                   if anything mandatory is still missing, returns a
                   single question for the next missing field instead
                   of failing. Call it again with the same `doctype` and
                   `session_id`, adding the user's answer into `data`
                   under the field name given in the response, and
                   repeat until it reports the record was created. Set
                   `submit` true to also submit a submittable doctype
                   (e.g. Sales Order, Purchase Order) right after
                   creating it.
      - 'update' : update an existing record identified by `name`.
                   `data` should only contain the fields being changed
                   (required).
      - 'submit' : submit an existing draft record identified by `name`.

    `session_id` distinguishes concurrent create flows for different
    users/conversations — pass the same value on every call that's part
    of filling in one record; a new record for the same doctype should
    use a different session_id (or finish/cancel the current one first).

    For data obtained from web_search, web_fetch_page, web_crawl, or
    web_company_lookup, set `web_enriched=True`. The tool will collect any
    remaining required fields, then return a review instead of creating the
    record. Only call it again with `approved=True` after the user has seen
    and approved that review. If the user rejects it, leave `approved` unset
    or false; refine the web search and submit the revised data for review.

    This tool never deletes, cancels, or removes any record under any
    circumstance — those operations are permanently disabled here.
    Always use 'update' to change status/fields instead."""

    op = (operation or "").strip().lower()

    if op in BLOCKED_OPERATIONS:
        return (
            f"The '{operation}' operation is not permitted through this tool. "
            "Only read, create, and update operations are allowed on ERPNext data."
        )

    if op in CREATE_OPERATIONS:
        return _run_create(doctype, data, submit, session_id, web_enriched, approved)

    def run():
        if op in LIST_OPERATIONS:
            req_fields = fields
            clean_filters = _normalize_filters(filters)
            if not req_fields:
                dt_lower = (doctype or "").strip().lower()
                if dt_lower == "sales order":
                    req_fields = ["name", "customer", "transaction_date", "grand_total", "status"]
                elif dt_lower == "work order":
                    req_fields = ["name", "production_item", "qty", "produced_qty", "status", "planned_start_date"]
                elif dt_lower == "purchase order":
                    req_fields = ["name", "supplier", "transaction_date", "grand_total", "status"]
                elif dt_lower == "item":
                    req_fields = ["name", "item_name", "item_group", "stock_uom"]
                elif dt_lower == "customer":
                    req_fields = ["name", "customer_name", "customer_group", "territory"]
                elif dt_lower == "lead":
                    req_fields = ["name", "lead_name", "company_name", "email_id", "status"]
                elif dt_lower == "supplier":
                    req_fields = ["name", "supplier_name", "supplier_group"]
                elif dt_lower == "employee":
                    req_fields = ["name", "employee_name", "department", "designation", "status"]

            return str(
                erp_client.get_list(
                    doctype,
                    fields=req_fields,
                    filters=clean_filters,
                    order_by=order_by,
                    limit=limit,
                )
            )

        if op in GET_OPERATIONS:
            if not name:
                return f"A document name/ID is required to fetch a {doctype} record."
            resolved_name = _resolve_link_value(doctype, name)
            if not resolved_name:
                return f"Could not find any exact or uniquely matching {doctype} for '{name}'."
            return str(erp_client.get_doc(doctype, resolved_name))

        if op in UPDATE_OPERATIONS:
            if not name:
                return f"A document name/ID is required to update a {doctype} record."
            resolved_name = _resolve_link_value(doctype, name)
            if not resolved_name:
                return f"Could not find any exact or uniquely matching {doctype} for '{name}'."
            if not data:
                return f"No `data` provided to update {doctype} '{name}'."
            prepared, warnings = _prepare_write_data(doctype, data)
            if not prepared:
                return _with_warnings(
                    f"No valid fields remain to update {doctype} '{resolved_name}'.", warnings
                )
            return _with_warnings(
                str(erp_client.update_doc(doctype, resolved_name, prepared)), warnings
            )

        if op in SUBMIT_OPERATIONS:
            if not name:
                return f"A document name/ID is required to submit a {doctype} record."
            resolved_name = _resolve_link_value(doctype, name)
            if not resolved_name:
                return f"Could not find any exact or uniquely matching {doctype} for '{name}'."
            return str(erp_client.submit_doc(doctype, resolved_name))

        return (
            f"Unknown operation '{operation}'. Use one of: "
            "list, get, create, update, submit."
        )

    return _safe_call(f"{op or 'process'} {doctype}", run)


def _review_text(doctype: str, data: dict) -> str:
    """Render a concise, non-ambiguous review payload for user approval."""
    visible = [f"- {field}: {value}" for field, value in data.items() if value not in (None, "", [], {})]
    return "\n".join(visible) if visible else "- No fields were supplied"


def _run_create(
    doctype: str,
    data: Optional[dict],
    submit: bool,
    session_id: str,
    web_enriched: bool = False,
    approved: Optional[bool] = None,
) -> str:
    """Implements the dynamic, one-field-at-a-time create flow described
    in erp_data_tool's docstring. Kept separate from the generic `run()`
    closure above because, unlike list/get/update/submit, this needs
    multiple ERPNext calls (a metadata lookup, then possibly the actual
    create) and its own control flow for the missing-fields case."""
    key = (session_id, doctype)
    pending = _PENDING_CREATES.get(key, {})
    merged = {**pending, **(data or {})}
    warnings: list[str] = []
    if web_enriched:
        _PENDING_WEB_REVIEWS.add(key)

    try:
        merged, warnings = _prepare_write_data(doctype, merged)
        if (
            doctype.strip().lower() == "lead"
            and merged.get("first_name")
            and merged.get("company_name")
            and str(merged["first_name"]).strip().casefold()
            == str(merged["company_name"]).strip().casefold()
        ):
            return (
                "I cannot create this Lead because the person's first name was mapped "
                "to the organization name. Please provide or research the person's name again."
            )
        merged = apply_default_values(doctype, merged)
        missing = missing_required_fields(doctype, merged)
    except Exception as exc:  # noqa: BLE001
        return explain_erp_error(exc, context=f"look up required fields for {doctype}")

    if missing:
        _PENDING_CREATES[key] = merged
        next_field = missing[0]
        message = (
            f"I need a bit more information to create this {doctype}. "
            f"{field_question(next_field)} "
            f"(field: {next_field['fieldname']}; {len(missing)} field(s) still "
            f"needed after this one is answered)\n"
            f"Once you have the answer, call erp_data_tool again with "
            f"operation='create', doctype='{doctype}', session_id='{session_id}', "
            f"and data={{'{next_field['fieldname']}': <answer>}}."
        )
        return _with_warnings(message, warnings)

    if key in _PENDING_WEB_REVIEWS and approved is not True:
        _PENDING_CREATES[key] = merged
        message = (
            f"REVIEW_REQUIRED: I gathered some of this {doctype} data from the web. "
            "Please review it before anything is created:\n"
            f"{_review_text(doctype, merged)}\n\n"
            "Do you want to create this record using this data? Reply yes to approve, "
            "or tell me which field is incorrect and what to look for instead. "
            "[AI INSTRUCTION: If the user approves, you MUST call this tool again with approved=True to execute the creation.]"
        )
        return _with_warnings(message, warnings)

    # Nothing missing — safe to actually create the record now.
    def run():
        result = erp_client.create_doc(doctype, merged)
        if submit:
            created_name = result.get("name")
            try:
                result = erp_client.submit_doc(doctype, created_name)
            except Exception as exc:  # noqa: BLE001
                # On submit failure, doc is still created, so we still pop state
                _PENDING_CREATES.pop(key, None)
                _PENDING_WEB_REVIEWS.discard(key)
                return str(result) + f" (created as draft; submit failed: {explain_erp_error(exc)})"
        
        # On success, clear the pending state
        _PENDING_CREATES.pop(key, None)
        _PENDING_WEB_REVIEWS.discard(key)
        return str(result)

    outcome = _with_warnings(_safe_call(f"create {doctype}", run), warnings)
    return outcome


@tool
def erp_describe_fields(doctype: str) -> str:
    """Looks up the LIVE ERPNext schema for a doctype. Use this before
    list/search calls whenever you are not certain of exact fieldnames,
    filter fields, or date fields. It returns every queryable field plus
    the subset required for creation. Never invent fieldnames."""

    def run():
        from ERP.dynamic_fields import get_available_fields, get_required_fields

        available = get_available_fields(doctype)
        req = get_required_fields(doctype)
        lines = [f"Queryable fields for {doctype} (label: fieldname [type]):"]
        lines.append("- ID / Primary Key: name [Data]")
        lines.extend(
            f"- {f['label']}: {f['fieldname']} [{f['fieldtype']}]"
            for f in available
        )
        lines.append("")
        if not req:
            lines.append("ERPNext does not mark any user-supplied field as required for creation.")
        else:
            lines.append("Required fields for creation:")
            for f in req:
                note = " (structured line items, not a single answer)" if f["is_table"] else ""
                lines.append(f"- {f['label']} ({f['fieldname']}){note}: {field_question(f)}")

        from ERP.doctype_knowledge import KNOWLEDGE_BASE
        if doctype in KNOWLEDGE_BASE:
            lines.append("")
            lines.append(f"### CRITICAL BUSINESS LOGIC FOR {doctype.upper()} ###")
            lines.append(KNOWLEDGE_BASE[doctype])
            
        return "\n".join(lines)

    return _safe_call(f"look up required fields for {doctype}", run)



@tool
def erp_send_email(
    recipients: str,
    subject: str,
    content: str,
    reference_doctype: str = None,
    reference_name: str = None,
    cc: str = None,
) -> str:
    """Sends an email to a client or contact through ERPNext.
    
    `recipients`: Comma-separated list of email addresses.
    `subject`: The subject line of the email.
    `content`: The HTML or plain text body of the email.
    `reference_doctype`: (Optional) The ERPNext document type to attach this email to (e.g. 'Lead', 'Customer', 'Project').
    `reference_name`: (Optional) The specific Document ID (e.g. 'CRM-LEAD-0001').
    `cc`: (Optional) Comma-separated list of CC email addresses.
    
    Always ensure you have confirmed the exact subject and content with the user before calling this.
    """
    def run():
        payload = {
            "recipients": recipients,
            "subject": subject,
            "content": content,
            "send_email": 1,
        }
        if cc:
            payload["cc"] = cc
        if reference_doctype and reference_name:
            resolved_name = _resolve_link_value(reference_doctype, reference_name)
            if not resolved_name:
                return f"Could not find exact match for reference {reference_doctype} '{reference_name}'."
            payload["doctype"] = reference_doctype
            payload["name"] = resolved_name
            
        try:
            result = erp_client.call_method_post(
                "frappe.core.doctype.communication.email.make", payload
            )
            return f"Email successfully queued/sent to {recipients}."
        except Exception as exc:
            return f"Failed to send email: {str(exc)}"

    return _safe_call(f"send email to {recipients}", run)


ERP_UNIFIED_TOOLS = [erp_data_tool, erp_describe_fields, erp_send_email, *PROJECT_ONBOARDING_TOOLS]
