import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

env_file = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_file)
load_dotenv()

from fastmcp import FastMCP

from ERP.erp_client import erp_client
from ERP.dynamic_fields import (
    missing_required_fields,
    get_required_fields,
    field_question,
    explain_erp_error,
    apply_default_values,
    safe_call as _safe_call,
)

mcp = FastMCP(name="erpnext-unified")

BLOCKED_OPERATIONS = {"delete", "remove", "trash", "destroy", "cancel", "purge", "drop"}
LIST_OPERATIONS = {"list", "get_list", "search", "find", "query"}
GET_OPERATIONS = {"get", "get_doc", "fetch", "detail", "details", "view"}
CREATE_OPERATIONS = {"create", "insert", "add", "new"}
UPDATE_OPERATIONS = {"update", "edit", "modify", "set"}
SUBMIT_OPERATIONS = {"submit"}

# Same in-memory "resume a partially-filled create" store as
# ERP_Unified/tools.py — see that file's comment on _PENDING_CREATES for
# the reasoning. Kept separate per-module since the MCP server and the
# direct LangChain tools run as different processes.
_PENDING_CREATES: dict[tuple, dict] = {}


def _run_create(doctype: str, data: Optional[dict], submit: bool, session_id: str) -> str:
    key = (session_id, doctype)
    pending = _PENDING_CREATES.get(key, {})
    merged = {**pending, **(data or {})}

    try:
        merged = apply_default_values(doctype, merged)
        missing = missing_required_fields(doctype, merged)
    except Exception as exc:
        return explain_erp_error(exc, context=f"look up required fields for {doctype}")

    if missing:
        _PENDING_CREATES[key] = merged
        next_field = missing[0]
        return (
            f"I need a bit more information to create this {doctype}. "
            f"{field_question(next_field)} "
            f"(field: {next_field['fieldname']}; {len(missing)} field(s) still "
            f"needed after this one is answered)\n"
            f"Once you have the answer, call erp_data_tool again with "
            f"operation='create', doctype='{doctype}', session_id='{session_id}', "
            f"and data={{'{next_field['fieldname']}': <answer>}}."
        )

    def run():
        result = erp_client.create_doc(doctype, merged)
        if submit:
            created_name = result.get("name")
            try:
                result = erp_client.submit_doc(doctype, created_name)
            except Exception as exc:
                return str(result) + f" (created as draft; submit failed: {explain_erp_error(exc)})"
        return str(result)

    outcome = _safe_call(f"create {doctype}", run)
    _PENDING_CREATES.pop(key, None)
    return outcome


@mcp.tool()
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
) -> str:
    """Single generic gateway to ERPNext for ANY doctype. `doctype` is
    the exact ERPNext doctype name (e.g. 'Sales Order', 'Customer',
    'Lead', 'Item', 'Quotation', 'Purchase Order', 'Employee',
    'Journal Entry', etc).

    `operation`:
      - 'list'   : list/search records via `fields`, `filters`
                   (ERPNext filter format), `order_by`, `limit`.
      - 'get'    : fetch one full record by `name`.
      - 'create' : create a record from `data` (can be partial). This
                   checks ERPNext's LIVE schema for what's required on
                   `doctype` and, if fields are still missing, returns
                   ONE question at a time for the next missing field
                   instead of failing outright — call again with the
                   same `doctype`/`session_id` and the answer added to
                   `data`, repeating until it reports success. Set
                   `submit` true to also submit it right after.
      - 'update' : update an existing record by `name` using `data`
                   (only the fields being changed).
      - 'submit' : submit an existing draft record by `name`.

    `session_id` distinguishes concurrent create flows for different
    users/conversations.

    Delete/cancel/remove operations are permanently disabled here."""

    op = (operation or "").strip().lower()

    if op in BLOCKED_OPERATIONS:
        return (
            f"The '{operation}' operation is not permitted through this tool. "
            "Only read, create, and update operations are allowed on ERPNext data."
        )

    if op in CREATE_OPERATIONS:
        return _run_create(doctype, data, submit, session_id)

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


@mcp.tool()
def erp_describe_fields(doctype: str) -> str:
    """Looks up, LIVE from ERPNext's own schema, which fields are
    required to create a record of `doctype` (any ERPNext doctype)."""

    def run():
        req = get_required_fields(doctype)
        if not req:
            return f"ERPNext doesn't mark any field as required to create a {doctype}."
        lines = [f"To create a {doctype}, ERPNext requires:"]
        for f in req:
            note = " (structured line items, not a single answer)" if f["is_table"] else ""
            lines.append(f"- {f['label']} ({f['fieldname']}){note}: {field_question(f)}")
        return "\n".join(lines)

    return _safe_call(f"look up required fields for {doctype}", run)


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.run(transport="streamable-http", host="0.0.0.0", port=8101)
    else:
        mcp.run()
