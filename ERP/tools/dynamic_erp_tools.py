"""
ERP/tools/dynamic_erp_tools.py

Replaces every hand-written per-doctype CRUD module (the old
sales_write_tools.py, inventory_write_tools.py, inventory_read_tools.py,
hr_write_tools.py, accounts_write_tools.py, purchase_write_tools.py,
purchase_read_tools.py, manufacturing_*_tools.py -- ~6000 lines across
14 files) with six generic tools that work against ANY ERPNext doctype:

    get_records(doctype, filters, fields, limit, order_by)
    get_record(doctype, name)
    count_records(doctype, filters)
    get_doctype_fields(doctype)
    create_record(doctype, data)
    update_record(doctype, name, data)
    delete_record(doctype, name)

Adding support for a new doctype now means nothing -- there's no
per-doctype code to add. Required fields are looked up live from
ERPNext's own metadata (custom_ui.api.metadata.get_complete_doctype_metadata,
via erp_client.get_doctype_metadata()) instead of a hand-maintained
REQUIRED_FIELDS dict.

create_record / update_record / delete_record are gated the same way
every other write tool always was: server.py's _is_write_tool() catches
their `create_`/`update_`/`delete_` name prefix and routes the call
through the write-confirmation flow before anything runs. For these
three specifically, server.py ALSO intercepts them earlier than that --
in agent_node, before confirmation -- to run the dynamic required-field
slot-filling flow (see _missing_fields / _dynamic_required_fields in
server.py) and, once confirmed, the retry+backtrace+escalation loop in
execute_pending_node. The bodies below are a working fallback for any
code path that calls them directly without going through that
interception (there shouldn't normally be one in the chat flow), not
the primary way these actually run.
"""

import json
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _stringify(value, limit: int = 4000) -> str:
    try:
        text = json.dumps(value, indent=2, default=str, ensure_ascii=False)
    except Exception:
        text = str(value)
    return text if len(text) <= limit else text[:limit] + "... (truncated)"


@tool
def get_records(
    doctype: str,
    filters: Optional[Dict[str, Any]] = None,
    fields: Optional[List[str]] = None,
    limit: Optional[int] = 20,
    order_by: Optional[str] = None,
) -> str:
    """Fetch a list of ERPNext records for ANY doctype (e.g. "Customer",
    "Sales Order", "Job Opening", "Item", "Employee"). Use this for any
    'show me', 'list', 'find', 'search for' request. `filters` is a
    field->value dict (e.g. {"status": "Open"}); `fields` restricts which
    columns come back (defaults to a reasonable set if omitted); `limit`
    caps how many rows (default 20)."""
    try:
        rows = erp_client.get_list(
            doctype, fields=fields, filters=filters, order_by=order_by, limit=limit or 20
        )
        return _stringify(rows)
    except PermissionError:
        raise
    except Exception as e:
        return f"Could not fetch {doctype} records: {e}"


@tool
def get_record(doctype: str, name: str) -> str:
    """Fetch ONE ERPNext record by its exact name/ID for ANY doctype.
    Use get_records first if you only have a human-friendly name and
    need to find the exact document name/ID."""
    try:
        return _stringify(erp_client.get_doc(doctype, name))
    except PermissionError:
        raise
    except Exception as e:
        return f"Could not fetch {doctype} '{name}': {e}"


@tool
def count_records(doctype: str, filters: Optional[Dict[str, Any]] = None) -> str:
    """Count how many ERPNext records of a doctype match `filters` (or
    all of them if filters is omitted). Use this for 'how many' questions
    instead of fetching the full list just to count it."""
    try:
        result = erp_client.count_doc(doctype, filters=filters)
        count = result.get("count", result) if isinstance(result, dict) else result
        return f"{count} {doctype} record(s) match." if filters else f"{count} total {doctype} record(s)."
    except PermissionError:
        raise
    except Exception as e:
        return f"Could not count {doctype} records: {e}"


@tool
def get_doctype_fields(doctype: str) -> str:
    """List the fields available on an ERPNext doctype -- which are
    required vs optional, their type, and allowed link/select options.
    Use this when the user asks what information is needed to create or
    update something, or when you need to know a field's exact name
    before calling create_record/update_record."""
    try:
        meta = erp_client.get_doctype_metadata(doctype)
        fields = meta.get("fields") or []
        lines = []
        for f in fields:
            if f.get("fieldtype") in ("Section Break", "Column Break", "Tab Break", "HTML"):
                continue
            marker = "REQUIRED" if f.get("reqd") else "optional"
            ro = " (read-only)" if f.get("read_only") else ""
            opts = f" [{f['options']}]" if f.get("options") else ""
            lines.append(f"- {f['fieldname']} ({f.get('label') or f['fieldname']}): {marker}, {f.get('fieldtype')}{opts}{ro}")
        return "\n".join(lines) if lines else f"No field metadata found for {doctype}."
    except PermissionError:
        raise
    except Exception as e:
        return f"Could not fetch field metadata for {doctype}: {e}"


@tool
def create_record(doctype: str, data: Optional[Dict[str, Any]] = None) -> str:
    """Create a new ERPNext record of ANY doctype (e.g. "Lead", "Customer",
    "Job Opening", "Item", "Sales Order"). Pass whatever field values you
    already know in `data` (e.g. {"customer_name": "Acme Corp"}) -- you do
    NOT need to know every required field yourself; the system will ask
    the user for anything still missing before actually saving anything.
    Never invent values for fields the user didn't give you."""
    try:
        result = erp_client.create_doc(doctype, data or {})
        return f"Created {doctype} '{result.get('name', '')}'."
    except PermissionError:
        raise
    except Exception as e:
        return f"Could not create {doctype}: {e}"


@tool
def update_record(doctype: str, name: str, data: Optional[Dict[str, Any]] = None) -> str:
    """Update an existing ERPNext record of ANY doctype. `name` is the
    exact document name/ID (use get_records to find it if you only have
    a human-friendly name). `data` should only contain the fields being
    changed."""
    try:
        result = erp_client.update_doc(doctype, name, data or {})
        return f"Updated {doctype} '{result.get('name', name)}'."
    except PermissionError:
        raise
    except Exception as e:
        return f"Could not update {doctype} '{name}': {e}"


@tool
def delete_record(doctype: str, name: str) -> str:
    """Delete an ERPNext record of ANY doctype by its exact name/ID.
    Destructive -- only call this after the user has clearly confirmed
    they want this specific record deleted."""
    try:
        erp_client.delete_doc(doctype, name)
        return f"Deleted {doctype} '{name}'."
    except PermissionError:
        raise
    except Exception as e:
        return f"Could not delete {doctype} '{name}': {e}"


DYNAMIC_ERP_TOOLS = [
    get_records,
    get_record,
    count_records,
    get_doctype_fields,
    create_record,
    update_record,
    delete_record,
]

# No static required-field metadata here on purpose -- server.py computes
# required fields for create_record/update_record live, per doctype, via
# erp_client.get_doctype_metadata(). See _dynamic_required_fields there.
REQUIRED_FIELDS = {}
FIELD_PARSERS = {}
