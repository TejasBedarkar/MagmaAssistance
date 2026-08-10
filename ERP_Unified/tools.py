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


def _prepare_lead_company(data: dict) -> tuple[dict, list[str]]:
    """Keep an external Lead organisation out of ERPNext's internal link.

    ``Lead.company`` is a Link to an existing internal ``Company`` document.
    A company found by the crawler (for example, Tata Motors) is normally
    the prospective customer's organisation and belongs in ``company_name``.
    """
    cleaned = dict(data or {})
    warnings: list[str] = []
    external_company = cleaned.get("company")
    if not isinstance(external_company, str) or not external_company.strip():
        return cleaned, warnings

    try:
        matches = erp_client.get_list(
            "Company",
            fields=["name"],
            filters=[["name", "=", external_company.strip()]],
            limit=1,
            use_cache=False,
        )
    except Exception:
        # Do not disguise an ERP connection or permission failure as an
        # invalid company value; the normal create call will report it.
        return cleaned, warnings

    if matches:
        return cleaned, warnings

    cleaned.pop("company", None)
    cleaned.setdefault("company_name", external_company.strip())
    warnings.append(
        f"Moved '{external_company.strip()}' from company to company_name because "
        "it is not an existing internal ERP Company."
    )
    return cleaned, warnings


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
                   [["status", "=", "Open"]]), `order_by`, and `limit`.
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
            return str(
                erp_client.get_list(
                    doctype,
                    fields=fields,
                    filters=filters,
                    order_by=order_by,
                    limit=limit,
                )
            )

        if op in GET_OPERATIONS:
            if not name:
                return f"A document name/ID is required to fetch a {doctype} record."
            return str(erp_client.get_doc(doctype, name))

        if op in UPDATE_OPERATIONS:
            if not name:
                return f"A document name/ID is required to update a {doctype} record."
            if not data:
                return f"No `data` provided to update {doctype} {name}."
            return str(erp_client.update_doc(doctype, name, data))

        if op in SUBMIT_OPERATIONS:
            if not name:
                return f"A document name/ID is required to submit a {doctype} record."
            return str(erp_client.submit_doc(doctype, name))

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

    if (doctype or "").strip().lower() == "lead":
        merged, warnings = _prepare_lead_company(merged)

    if web_enriched:
        _PENDING_WEB_REVIEWS.add(key)

    try:
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
        return ("Validation adjustment: " + " ".join(warnings) + "\n" if warnings else "") + message

    if key in _PENDING_WEB_REVIEWS and approved is not True:
        _PENDING_CREATES[key] = merged
        message = (
            f"REVIEW_REQUIRED: I gathered some of this {doctype} data from the web. "
            "Please review it before anything is created:\n"
            f"{_review_text(doctype, merged)}\n\n"
            "Do you want to create this record using this data? Reply yes to approve, "
            "or tell me which field is incorrect and what to look for instead."
        )
        return ("Validation adjustment: " + " ".join(warnings) + "\n" if warnings else "") + message

    # Nothing missing — safe to actually create the record now.
    def run():
        result = erp_client.create_doc(doctype, merged)
        if submit:
            created_name = result.get("name")
            try:
                result = erp_client.submit_doc(doctype, created_name)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {explain_erp_error(exc)})"
        return str(result)

    outcome = _safe_call(f"create {doctype}", run)
    if warnings:
        outcome = "Validation adjustment: " + " ".join(warnings) + "\n" + outcome
    # Whether it succeeded or failed, this attempt is done — clear the
    # pending state so a retry (e.g. after fixing a bad link value)
    # starts from the fields the user already gave rather than getting
    # stuck re-asking things that were fine. On a genuine ERPNext error
    # the caller still has `merged` available to retry manually with
    # corrections if needed.
    _PENDING_CREATES.pop(key, None)
    _PENDING_WEB_REVIEWS.discard(key)
    return outcome


@tool
def erp_describe_fields(doctype: str) -> str:
    """Looks up, LIVE from ERPNext's own schema, which fields are
    required to create a record of `doctype` (any ERPNext doctype).
    Use this when the user asks something like 'what do you need to
    create a <doctype>?' or before starting a multi-field create so you
    know what to ask for — though calling erp_data_tool with
    operation='create' directly will also surface missing fields one at
    a time on its own."""

    def run():
        from ERP.dynamic_fields import get_required_fields

        req = get_required_fields(doctype)
        if not req:
            return f"ERPNext doesn't mark any field as required to create a {doctype}."
        lines = [f"To create a {doctype}, ERPNext requires:"]
        for f in req:
            note = " (structured line items, not a single answer)" if f["is_table"] else ""
            lines.append(f"- {f['label']} ({f['fieldname']}){note}: {field_question(f)}")
        return "\n".join(lines)

    return _safe_call(f"look up required fields for {doctype}", run)


ERP_UNIFIED_TOOLS = [erp_data_tool, erp_describe_fields, *PROJECT_ONBOARDING_TOOLS]
