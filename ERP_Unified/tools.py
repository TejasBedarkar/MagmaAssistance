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
from ERP.tools.task_assignment_tools import TASK_ASSIGNMENT_TOOLS
from ERP.tools.crm_conversion_tools import CRM_CONVERSION_TOOLS

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

# Which single field a session is currently being asked about, so a direct
# answer can be routed to that exact field server-side instead of trusting
# the model to reconstruct the right fieldname -- it doesn't reliably do
# that once several fields have been asked about in one create flow.
_PENDING_CREATE_FIELD: dict[str, tuple[str, str]] = {}


def get_pending_create_field(session_id: str) -> Optional[tuple[str, str]]:
    """Returns (doctype, fieldname) if `session_id` is mid-way through a
    create flow and was just asked for one specific field, else None."""
    return _PENDING_CREATE_FIELD.get(session_id)


def get_pending_create_data(session_id: str, doctype: str) -> dict:
    """Returns whatever has already been accumulated for this session's
    in-progress create flow on `doctype` (empty dict if none) -- used to
    build an accurate write-approval preview. The actual create call
    already merges this internally regardless; this is purely so the gate
    can DISPLAY the full picture instead of just the one field the model
    happened to pass on this specific turn."""
    return dict(_PENDING_CREATES.get((session_id, doctype), {}))

# Web-derived values are useful suggestions, not authority to write to the
# ERP. Keep the review requirement alongside the pending create payload so a
# user must explicitly approve the final assembled record before it is sent.
_PENDING_WEB_REVIEWS: set[tuple] = set()


def record_web_research_activity(session_id: str, doctype: Optional[str] = None):
    """Mark that this session has performed web research/crawler extraction,
    so that any subsequent record creation in this session requires explicit review."""
    if not session_id:
        return
    if doctype:
        _PENDING_WEB_REVIEWS.add((session_id, doctype))
    else:
        _PENDING_WEB_REVIEWS.add((session_id, "*"))


def is_web_review_pending(session_id: str, doctype: Optional[str] = None) -> bool:
    if not session_id:
        return False
    if doctype and (session_id, doctype) in _PENDING_WEB_REVIEWS:
        return True
    return (session_id, "*") in _PENDING_WEB_REVIEWS


def pending_web_review_doctype(session_id: str) -> Optional[str]:
    """Return the one reviewed record awaiting this session's approval.

    The chat server uses this to turn an ordinary human reply such as
    ``yes, create it`` into a deterministic approved create call instead of
    relying on the model to reconstruct tool arguments.
    """
    pending = [doctype for review_session, doctype in _PENDING_WEB_REVIEWS if review_session == session_id and doctype != "*"]
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
        
    # Special handling for Country DocType: check ISO 2-letter or 3-letter codes and 'code' field
    if target_doctype.strip().lower() == "country":
        iso_map = {
            "in": "India", "ind": "India", "us": "United States", "usa": "United States",
            "uk": "United Kingdom", "gb": "United Kingdom", "gbr": "United Kingdom",
            "ae": "United Arab Emirates", "uae": "United Arab Emirates",
            "ca": "Canada", "can": "Canada", "au": "Australia", "aus": "Australia",
            "de": "Germany", "deu": "Germany", "fr": "France", "fra": "France",
            "sg": "Singapore", "sgp": "Singapore",
        }
        val_clean = value_str.strip().lower()
        if val_clean in iso_map:
            mapped_name = iso_map[val_clean]
            try:
                matches = erp_client.get_list("Country", fields=["name"], filters=[["name", "=", mapped_name]], limit=1, use_cache=False)
                if matches:
                    return matches[0]["name"]
            except Exception:
                pass
        try:
            matches = erp_client.get_list("Country", fields=["name"], filters=[["code", "=", val_clean]], limit=1, use_cache=False)
            if matches:
                return matches[0]["name"]
        except Exception:
            pass

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


def _fallback_to_name_filter(doctype: str, filters: Optional[list], fields, order_by, limit: int):
    """If a `list` query on a non-`name` field returns nothing, some
    doctypes (Item, Customer, Supplier, ...) use `name` itself as the
    business code (e.g. Item.name IS the item_code, not item_name) -- a
    query on item_name/customer_name for a value that's actually the code
    silently returns empty. Retry once against `name` directly before
    reporting that nothing was found."""
    if not filters:
        return None, []
    candidate = None
    for f in filters:
        if isinstance(f, (list, tuple)) and len(f) == 3 and f[0] != "name" and isinstance(f[2], str):
            candidate = f[2].strip("%").strip()
            break
    if not candidate:
        return None, []
    try:
        retry = erp_client.get_list(
            doctype, fields=fields, filters=[["name", "=", candidate]], order_by=order_by, limit=limit
        )
    except Exception:  # noqa: BLE001
        return None, []
    if retry:
        return retry, [f"No match on the requested field, but found by name='{candidate}' instead."]
    return None, []


def _resolve_link_filters(doctype: str, filters: Optional[list]) -> tuple[Optional[list], list[str]]:
    """Same fix as _prepare_write_data, but for `list` filters: if a Link
    field is filtered by a human-readable name instead of its real ID (e.g.
    BOM.item like '%HB Pencil%' instead of '=FG-001'), that silently matches
    nothing. Resolve it to the real ID first via _resolve_link_value."""
    if not filters:
        return filters, []
    try:
        meta = erp_client.get_meta(doctype)
    except Exception:
        return filters, []
    fields = {f.get("fieldname"): f for f in meta.get("fields", []) or [] if f.get("fieldname")}

    resolved_filters = []
    warnings: list[str] = []
    for f in filters:
        if not (isinstance(f, (list, tuple)) and len(f) == 3):
            resolved_filters.append(f)
            continue
        fieldname, op, value = f
        field = fields.get(fieldname)
        target_doctype = field.get("options") if field else None
        if field is None or field.get("fieldtype") != "Link" or not target_doctype or not isinstance(value, str):
            resolved_filters.append(f)
            continue
        bare_value = value.strip("%").strip()
        if not bare_value:
            resolved_filters.append(f)
            continue
        resolved_id = _resolve_link_value(target_doctype, bare_value)
        if resolved_id and resolved_id != bare_value:
            resolved_filters.append([fieldname, "=", resolved_id])
            warnings.append(f"Resolved {fieldname}='{value}' to {target_doctype} '{resolved_id}'.")
        else:
            resolved_filters.append(f)
    return resolved_filters, warnings


_NAMING_TEMPLATE_RE = re.compile(r'\.(YYYY|YY|MM|DD|#+)\b')


def _looks_like_naming_template(value) -> bool:
    """True for a raw Frappe naming-series pattern like 'CUST-.YYYY.-', which is a template, not a record ID."""
    return isinstance(value, str) and bool(_NAMING_TEMPLATE_RE.search(value))


# Doctypes convert_crm_record can move a record on from -- if a value that
# failed to resolve turns out to actually be one of these, the model almost
# certainly reused that record's own ID instead of converting it first.
_PIPELINE_SOURCE_DOCTYPES = ("Lead", "Opportunity", "Quotation")


def _find_pipeline_source(target_doctype: str, value) -> Optional[str]:
    """If `value` is really the ID of a Lead/Opportunity/Quotation instead of a {target_doctype}, return which."""
    if not isinstance(value, str) or not value:
        return None
    for src in _PIPELINE_SOURCE_DOCTYPES:
        if src == target_doctype:
            continue
        try:
            matches = erp_client.get_list(src, fields=["name"], filters=[["name", "=", value]], limit=1, use_cache=False)
        except Exception:
            continue
        if matches:
            return src
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

    if doctype.strip().lower() == "task" and cleaned.get("assigned_to"):
        # a common, wrong instinct -- Task has no such field, assignment is
        # a separate Frappe mechanism (frappe.desk.form.assign_to.add),
        # exposed here via the reassign_tasks tool. Silently dropping this
        # like any other unknown field would leave the model no way to
        # self-correct -- name it explicitly instead.
        warnings.append(
            f"Ignored assigned_to='{cleaned['assigned_to']}' -- Task has no such field. "
            "To assign or reassign a Task, use the reassign_tasks tool instead."
        )
        cleaned.pop("assigned_to", None)

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
            cleaned.pop(fieldname, None)
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
                    if _looks_like_naming_template(value):
                        warnings.append(
                            f"Omitted {fieldname}='{value}' -- that's a naming "
                            f"series template, not a real record ID. Use the exact "
                            f"`name` value an earlier tool result actually returned "
                            f"for that {target_doctype}, not one guessed from its pattern."
                        )
                    else:
                        source_doctype = _find_pipeline_source(target_doctype, value)
                        if source_doctype:
                            warnings.append(
                                f"Omitted {fieldname}='{value}' -- that's the ID of an "
                                f"existing {source_doctype}, not a {target_doctype}. "
                                f"Convert it with convert_crm_record first, then use the "
                                f"{target_doctype} ID that returns."
                            )
                        else:
                            warnings.append(
                                f"Omitted {fieldname}='{value}' because no matching "
                                f"{target_doctype} exists in MagnaERP."
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
                
        if fieldtype == "Table":
            if not isinstance(value, list):
                cleaned.pop(fieldname, None)
                warnings.append(
                    f"Omitted {fieldname} because it requires a list of table rows, but a {type(value).__name__} was provided."
                )
            continue

        # catches e.g. Notes getting a list instead of a string
        if fieldtype not in ("Table", "Table MultiSelect", "Link", "Dynamic Link", "Select") and isinstance(value, (list, dict)):
            cleaned.pop(fieldname, None)
            warnings.append(
                f"Omitted {fieldname} because it expects a single value, but a {type(value).__name__} was provided."
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


_KNOWN_OPS = {"like", "notlike", "=", "!=", ">", ">=", "<", "<="} | set(_OPERATOR_MAP)


def _looks_like_operator(value) -> bool:
    if not isinstance(value, str):
        return False
    return value.lower().replace(" ", "").replace("_", "").replace("-", "") in _KNOWN_OPS


def _filter_triple(field: str, op: str, value):
    """Builds one [field, op, value] filter, adding % wildcards to a bare 'like' value."""
    op_key = str(op).lower().replace(" ", "").replace("_", "").replace("-", "")
    clean_op = _OPERATOR_MAP.get(op_key, str(op))
    if op_key in ("like", "notlike") and isinstance(value, str) and "%" not in value:
        value = f"%{value}%"
    return [field, clean_op, value]


def _normalize_filters(filters: Optional[list | dict]) -> Optional[list]:
    """Convert natural language comparison operators ('greater than', 'greaterthan', 'less than')
    to standard SQL/Frappe comparison operators ('>', '<', '>=', etc.). Also handles
    lists of single-key filter dicts or a top-level dict produced by LLMs."""
    if not filters:
        return filters
    normalized = []
    items = filters.items() if isinstance(filters, dict) else filters
    for f in items:
        if isinstance(f, tuple) and len(f) == 2 and isinstance(f[0], str):
            k, v = f
            if isinstance(v, (list, tuple)) and len(v) == 2:
                normalized.append(_filter_triple(k, v[0], v[1]))
            elif isinstance(v, (list, tuple)) and len(v) >= 3:
                normalized.append(list(v))
            else:
                normalized.append([k, "=", v])
        elif isinstance(f, dict):
            # A model sometimes spells one filter as two dict keys instead of
            # the documented {field: [op, val]} -- e.g. {field: "like", "value":
            # x} or even {field: "like", x: ""} with the value used as a key.
            # Whichever key's value reads as an operator is the field/op pair;
            # the other pair supplies the actual value (its value if present,
            # else its own key, since that's where the model put the value).
            if len(f) == 2:
                pairs = list(f.items())
                op_pair = next((p for p in pairs if _looks_like_operator(p[1])), None)
                if op_pair:
                    field, op = op_pair
                    other_key, other_val = next(p for p in pairs if p is not op_pair)
                    value = other_val if other_val not in (None, "") else other_key
                    normalized.append(_filter_triple(field, op, value))
                    continue
            for k, v in f.items():
                if isinstance(v, (list, tuple)) and len(v) == 2:
                    normalized.append(_filter_triple(k, v[0], v[1]))
                elif isinstance(v, (list, tuple)) and len(v) >= 3:
                    normalized.append(list(v))
                else:
                    normalized.append([k, "=", v])
        elif isinstance(f, (list, tuple)) and len(f) >= 3:
            normalized.append(_filter_triple(f[0], f[1], f[2]))
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
    limit: Optional[int] = None,
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
            "Only read, create, and update operations are allowed on MagnaERP data."
        )

    if op in CREATE_OPERATIONS:
        return _run_create(doctype, data, submit, session_id, web_enriched, approved)

    def run():
        if op in LIST_OPERATIONS:
            req_fields = fields
            clean_filters = _normalize_filters(filters)
            clean_filters, link_warnings = _resolve_link_filters(doctype, clean_filters)
            dt_lower = (doctype or "").strip().lower()
            if not req_fields:
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

            effective_order_by = order_by
            # Deterministic, code-level cap for Leads instead of relying on
            # the model to slice/count a returned list itself -- it doesn't
            # do that reliably. Treat an explicit limit=10 the same as no
            # limit at all: the model is told not to pass it, but sometimes
            # redundantly does anyway, and 10 rows + a remaining-count line
            # is the right result either way. Any other explicit limit
            # (e.g. "show me 20 leads") is respected as a genuine ask.
            auto_cap_leads = dt_lower == "lead" and (limit is None or limit == 10)
            if dt_lower == "lead":
                if not effective_order_by:
                    effective_order_by = "creation desc"
                fetch_limit = 200 if auto_cap_leads else limit
            else:
                fetch_limit = limit if limit is not None else 20

            results = erp_client.get_list(
                doctype, fields=req_fields, filters=clean_filters, order_by=effective_order_by, limit=fetch_limit,
            )
            if not results and clean_filters:
                fallback, fallback_warnings = _fallback_to_name_filter(
                    doctype, clean_filters, req_fields, effective_order_by, fetch_limit
                )
                if fallback:
                    results = fallback
                    link_warnings = link_warnings + fallback_warnings

            summary_prefix = ""
            if auto_cap_leads and len(results) > 10:
                total = len(results)
                remaining = total - 10
                results = results[:10]
                summary_prefix = (
                    f"Showing the 10 most recent Leads out of {total} total "
                    f"({remaining} more not shown).\n"
                )

            return _with_warnings(summary_prefix + str(results), link_warnings)

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


_MISSING_FIELD_ERROR_PATTERNS = [
    re.compile(r"please enter ([A-Za-z0-9 /&()-]+?)(?:\.|$)", re.IGNORECASE),
    re.compile(r"^([A-Za-z0-9 /&()-]+?) is mandatory", re.IGNORECASE),
]


def _guess_missing_field(doctype: str, error_text: str) -> Optional[dict]:
    """ERPNext's own custom validate() methods (not just schema reqd=1)
    often reject a create with a 'Please enter X' / 'X is mandatory'
    message -- these fields never show up in missing_required_fields()
    (which only reads schema-level reqd), so nothing here previously knew
    which real fieldname X was. Best-effort match the label back to a
    real field so the same field-routing nudge that handles a schema-
    required field can pick this up too, instead of the model losing
    track of the whole in-progress record once this kind of error hits."""
    label_guess = None
    for pattern in _MISSING_FIELD_ERROR_PATTERNS:
        m = pattern.search(error_text)
        if m:
            label_guess = m.group(1).strip()
            break
    if not label_guess:
        return None
    try:
        meta = erp_client.get_meta(doctype)
    except Exception:  # noqa: BLE001
        return None
    for f in meta.get("fields", []) or []:
        if (f.get("label") or "").strip().lower() == label_guess.lower():
            return {
                "fieldname": f.get("fieldname"),
                "label": f.get("label"),
                "fieldtype": f.get("fieldtype"),
                "options": f.get("options"),
            }
    return None


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
        # Mark this specific doctype+session as web-enriched for the review gate
        _PENDING_WEB_REVIEWS.add(key)
    elif (session_id, doctype) in _PENDING_WEB_REVIEWS:
        # Re-use web_enriched status only if the same doctype in this session was already web-enriched
        # (e.g., partial create re-entry). Does NOT bleed across unrelated doctypes.
        web_enriched = True

    # Preserve address details before schema filtering for DocTypes that use separate Address records (e.g. Lead)
    address_info = {}
    if doctype.strip().lower() == "lead":
        for k in ("address", "address_line1", "city", "pincode", "country", "state"):
            if merged.get(k):
                address_info[k] = merged[k]

        # For Lead, since ERPNext standard Lead DocType has city, state, country (but no separate address_line1),
        # merge address_line1 into city so the full street/premise address is preserved directly on the Lead form.
        addr_line1 = address_info.get("address_line1")
        city_val = address_info.get("city")
        state_val = address_info.get("state")
        country_val = address_info.get("country") or "India"

        if addr_line1 and city_val:
            if addr_line1.strip().lower() not in city_val.strip().lower():
                merged["city"] = f"{addr_line1.strip()}, {city_val.strip()}"
            else:
                merged["city"] = city_val.strip()
        elif addr_line1 and not city_val:
            merged["city"] = addr_line1.strip()
        elif address_info.get("address") and not city_val:
            merged["city"] = str(address_info.get("address")).strip()
        elif city_val:
            merged["city"] = city_val.strip()

        if state_val and not merged.get("state"):
            merged["state"] = state_val.strip()
        if country_val and not merged.get("country"):
            merged["country"] = country_val.strip()

    try:
        # defaults first, then sanitize -- otherwise a bad schema default
        # (e.g. a raw "Today" token) slips past _prepare_write_data's
        # validation and reaches ERPNext as a literal, invalid value
        merged = apply_default_values(doctype, merged)
        merged, warnings = _prepare_write_data(doctype, merged)
        if doctype.strip().lower() == "lead":
            if (
                merged.get("first_name")
                and merged.get("company_name")
                and str(merged["first_name"]).strip().casefold()
                == str(merged["company_name"]).strip().casefold()
            ):
                return (
                    "I cannot create this Lead because the person's first name was mapped "
                    "to the organization name. Please provide or research the person's name again."
                )
            # Ensure lead_name is populated from contact person or organization name
            if not merged.get("lead_name"):
                merged["lead_name"] = merged.get("first_name") or merged.get("company_name")
        merged = apply_default_values(doctype, merged)
        missing = missing_required_fields(doctype, merged)
    except Exception as exc:  # noqa: BLE001
        return explain_erp_error(exc, context=f"look up required fields for {doctype}")

    if missing:
        _PENDING_CREATES[key] = merged
        next_field = missing[0]
        _PENDING_CREATE_FIELD[session_id] = (doctype, next_field["fieldname"])
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

    # Nothing left to ask about -- clear the field-tracking state.
    _PENDING_CREATE_FIELD.pop(session_id, None)

    if (web_enriched or key in _PENDING_WEB_REVIEWS or (session_id, "*") in _PENDING_WEB_REVIEWS) and approved is not True:
        _PENDING_CREATES[key] = merged
        _PENDING_WEB_REVIEWS.add(key)
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
        try:
            result = erp_client.create_doc(doctype, merged)
        except Exception as create_exc:
            if "Email Address must be unique" in str(create_exc) and doctype.strip().lower() == "lead" and "email_id" in merged:
                # Retry without top-level email on Lead, preserving email in linked Address
                merged.pop("email_id", None)
                try:
                    result = erp_client.create_doc(doctype, merged)
                except Exception:
                    raise create_exc
            else:
                raise

        created_lead_id = result.get("name") if isinstance(result, dict) else str(result)

        # If Lead has address information, create and link an associated Address record
        if doctype.strip().lower() == "lead" and (address_info.get("address_line1") or address_info.get("address") or address_info.get("city")):
            addr_line1 = address_info.get("address_line1") or address_info.get("address") or "Headquarters"
            city_for_addr = address_info.get("city") or "Not Specified"
            pincode = address_info.get("pincode") or ""
            country = _resolve_link_value("Country", address_info.get("country") or "India") or "India"
            state_for_addr = address_info.get("state") or ""
            base_title = merged.get("company_name") or merged.get("lead_name") or created_lead_id
            address_doc = {
                "doctype": "Address",
                "address_title": base_title,
                "address_type": "Office",
                "address_line1": addr_line1,
                "city": city_for_addr,
                "state": state_for_addr,
                "pincode": pincode,
                "country": country,
                "email_id": merged.get("email_id"),
                "phone": merged.get("mobile_no") or merged.get("phone"),
                "links": [
                    {"link_doctype": "Lead", "link_name": created_lead_id}
                ]
            }
            try:
                erp_client.create_doc("Address", address_doc)
            except Exception as addr_exc:
                # If name conflict, try with unique lead-scoped address title
                try:
                    address_doc["address_title"] = f"{base_title} - {created_lead_id}"
                    erp_client.create_doc("Address", address_doc)
                except Exception as retry_exc:
                    logger.warning("Could not create linked Address for Lead %s: %s", created_lead_id, retry_exc)

        if submit:
            created_name = result.get("name")
            try:
                result = erp_client.submit_doc(doctype, created_name)
            except Exception as exc:  # noqa: BLE001
                # On submit failure, doc is still created, so we still pop state
                _PENDING_CREATES.pop(key, None)
                _PENDING_WEB_REVIEWS.discard(key)
                _PENDING_WEB_REVIEWS.discard((session_id, "*"))
                return str(result) + f" (created as draft; submit failed: {explain_erp_error(exc)})"
        
        # On success, clear the pending state
        _PENDING_CREATES.pop(key, None)
        _PENDING_WEB_REVIEWS.discard(key)
        _PENDING_WEB_REVIEWS.discard((session_id, "*"))
        return str(result)

    outcome = _safe_call(f"create {doctype}", run)
    if isinstance(outcome, str) and outcome.startswith("Couldn't"):
        guessed = _guess_missing_field(doctype, outcome)
        if guessed:
            # ERPNext's server-side check rejected this even though the
            # schema-level missing_required_fields() pass above found
            # nothing wrong -- persist what we already had so the next
            # turn's merge (line 649) doesn't start from empty.
            _PENDING_CREATES[key] = merged
            _PENDING_CREATE_FIELD[session_id] = (doctype, guessed["fieldname"])
            outcome += (
                f"\n{field_question(guessed)} Once you have the answer, call "
                f"erp_data_tool again with operation='create', doctype='{doctype}', "
                f"session_id='{session_id}', and data={{'{guessed['fieldname']}': <answer>}}."
            )
    return _with_warnings(outcome, warnings)


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
        for f in available:
            if f['fieldtype'] in {"Table", "Table MultiSelect"} and f.get('options'):
                lines.append(f"- {f['label']}: {f['fieldname']} [List of {f['options']} dicts]")
                try:
                    child_fields = get_available_fields(f['options'])
                    lines.append(f"  (Child fields: {', '.join([cf['fieldname'] for cf in child_fields])})")
                except Exception:
                    pass
            else:
                lines.append(f"- {f['label']}: {f['fieldname']} [{f['fieldtype']}]")
        lines.append("")
        if not req:
            lines.append("MagnaERP does not mark any user-supplied field as required for creation.")
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


ERP_UNIFIED_TOOLS = [
    erp_data_tool, erp_describe_fields, erp_send_email,
    *PROJECT_ONBOARDING_TOOLS, *TASK_ASSIGNMENT_TOOLS, *CRM_CONVERSION_TOOLS,
]
