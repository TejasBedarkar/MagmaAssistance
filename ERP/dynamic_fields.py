"""
ERP/dynamic_fields.py

Shared helpers so ERPNext's REQUIRED fields are discovered live from the
site's own schema instead of hand-maintained lists, and so a raw ERPNext
exception gets turned into something a non-technical user can actually
understand. Used by both:
  - ERP_Unified/tools.py  (the single generic `erp_data_tool`)
  - ERP/tools/*_write_tools.py (the per-domain tools, via `safe_call`)

Why dynamic: ERP/tools/*_write_tools.py's REQUIRED_FIELDS dicts are
hand-written per tool and only cover the handful of doctypes those tools
target. `erp_data_tool` works against ANY doctype, so there's no way to
hand-maintain that list for it — it has to ask ERPNext itself, via
erp_client.get_meta(doctype), which fields are actually marked
mandatory (`reqd=1`) on that doctype right now.
"""

import json
import re

from ERP.erp_client import erp_client

# Layout-only fieldtypes that can be marked reqd in ERPNext's doctype
# builder by mistake/inheritance but never hold a value themselves —
# never worth asking the user about.
_NON_DATA_FIELDTYPES = {
    "Section Break", "Column Break", "Tab Break", "HTML", "Button",
    "Heading", "Fold",
}

# Fields ERPNext fills in itself (naming, ownership, workflow bookkeeping)
# — even if they show up as reqd on some doctypes, a user should never be
# asked about them by name.
_SYSTEM_FIELDNAMES = {
    "naming_series", "amended_from", "owner", "docstatus", "idx",
}


# ---------------------------------------------------------------------
# Field discovery
# ---------------------------------------------------------------------

def get_required_fields(doctype: str, exclude: set | None = None) -> list[dict]:
    """Returns the ordered list of fields ERPNext's live schema marks as
    mandatory (`reqd == 1`) for `doctype`, as dicts with fieldname,
    label, fieldtype, options, description, and is_table.

    `exclude` is a set of fieldnames to leave out (e.g. ones the caller
    already has a value for). Table (child-table) fields are included
    but flagged `is_table: True` so callers can handle them separately
    instead of asking a plain one-line question for something that
    actually needs structured rows (e.g. a Sales Order's `items`).

    Raises whatever erp_client.get_meta() raises (network/auth errors) —
    callers should wrap this in explain_erp_error() for a user-facing
    message rather than swallowing it silently, since a metadata-fetch
    failure means we genuinely can't tell what's required.
    """
    exclude = exclude or set()
    meta = erp_client.get_meta(doctype)
    raw_fields = meta.get("fields", []) or []

    required = []
    for f in raw_fields:
        fieldname = f.get("fieldname")
        if not fieldname or fieldname in _SYSTEM_FIELDNAMES:
            continue
        if fieldname in exclude:
            continue
        if not f.get("reqd"):
            continue
        if f.get("fieldtype") in _NON_DATA_FIELDTYPES:
            continue
        if f.get("hidden"):
            continue
        required.append({
            "fieldname": fieldname,
            "label": f.get("label") or fieldname.replace("_", " ").title(),
            "fieldtype": f.get("fieldtype"),
            "options": f.get("options"),
            "description": f.get("description"),
            "is_table": f.get("fieldtype") == "Table",
        })

    return required


def missing_required_fields(doctype: str, data: dict | None) -> list[dict]:
    """Same as get_required_fields(), but filtered down to the ones NOT
    already present (and non-empty) in `data`."""
    data = data or {}
    present = {k for k, v in data.items() if v not in (None, "", [], {})}
    return get_required_fields(doctype, exclude=present)


def field_question(field: dict) -> str:
    """Turns one field-meta dict (from get_required_fields) into a single
    natural-language question to ask the user — this is what powers the
    'ask one by one' flow: callers walk the missing-fields list and pose
    exactly one of these per turn, instead of dumping the whole list on
    the user at once."""
    label = field["label"]
    fieldtype = field.get("fieldtype")
    options = field.get("options")

    if fieldtype == "Link" and options:
        return f"What is the {label}? (this should be an existing {options} in ERPNext)"
    if fieldtype == "Select" and options:
        choices = [c.strip() for c in str(options).split("\n") if c.strip()]
        if choices:
            return f"What is the {label}? Choose one of: {', '.join(choices)}"
    if fieldtype == "Date":
        return f"What is the {label}? (format YYYY-MM-DD)"
    if fieldtype == "Datetime":
        return f"What is the {label}? (format YYYY-MM-DD HH:MM:SS)"
    if fieldtype == "Check":
        return f"Is '{label}' yes or no?"
    if fieldtype in ("Int", "Float", "Currency", "Percent"):
        return f"What is the {label}? (a number)"
    if fieldtype == "Table":
        return (
            f"'{label}' needs one or more line items — give each as "
            "'field, field, field' separated by semicolons for multiple rows."
        )
    return f"What is the {label}?"


def apply_default_values(doctype: str, data: dict | None) -> dict:
    """Returns a copy of `data` with sensible values auto-filled in for
    required fields that are still missing after the user's answers,
    instead of leaving them to either (a) trip an infinite "please
    provide X" loop if excluded from missing_required_fields entirely
    without ever getting a value, or (b) fail the actual ERPNext create
    call with a mandatory-field error once submitted.

    Two cases are handled:
      - The field has a schema-level `default` in ERPNext's own meta
        (rare for Select fields in practice, but some doctypes do set
        one) — use that.
      - The field is a required Select with no schema default (e.g.
        Lead.status, which ERPNext's own New Lead form silently opens
        on "Lead" without the field.default meta property actually
        being set) — fall back to the first line of `options`, matching
        the same convention Frappe's own UI uses for an unset Select.

    Every other required field type (Link, Data, Date, Table, ...) is
    left alone — there's no safe generic guess for a customer name or a
    delivery date, so those still go through the normal one-by-one
    question flow in missing_required_fields()/field_question().
    """
    data = dict(data or {})
    try:
        meta = erp_client.get_meta(doctype)
    except Exception:  # noqa: BLE001
        # Can't reach ERPNext's schema right now -- leave data as-is and
        # let the normal missing-fields/error-explanation path surface
        # whatever's actually wrong, rather than guessing blind here.
        return data

    for f in meta.get("fields", []) or []:
        fieldname = f.get("fieldname")
        if not fieldname or fieldname in _SYSTEM_FIELDNAMES:
            continue
        if not f.get("reqd"):
            continue
        if data.get(fieldname) not in (None, "", [], {}):
            continue  # already has a real value, don't overwrite it

        default = f.get("default")
        if default not in (None, ""):
            data[fieldname] = default
            continue

        if f.get("fieldtype") == "Select" and f.get("options"):
            choices = [c.strip() for c in str(f["options"]).split("\n") if c.strip()]
            if choices:
                data[fieldname] = choices[0]

    return data


def next_question(doctype: str, data: dict | None) -> tuple[dict, str] | None:
    """Convenience wrapper: returns (field, question) for the SINGLE next
    missing required field for `doctype` given what's already in `data`,
    or None if nothing is missing. This is the core of the one-by-one
    flow — callers ask this question, get the user's answer, add it to
    `data` under field['fieldname'], and call this again for the next
    one, exactly like filling in a form field by field."""
    missing = missing_required_fields(doctype, data)
    if not missing:
        return None
    field = missing[0]
    return field, field_question(field)


# ---------------------------------------------------------------------
# Friendly error explanations
# ---------------------------------------------------------------------

def _extract_server_messages(exc: Exception) -> list[str]:
    """Frappe/ERPNext puts the real validation message(s) inside a
    `_server_messages` JSON-encoded list on the HTTP error response,
    which erp_client.create_doc/update_doc already appends to the
    exception text as '| ERPNext Rule Failure: ...'. This also handles
    the raw response case (if erp_client's own formatting isn't
    present, e.g. from get_list/get_doc/call_method paths)."""
    text = str(exc)
    messages = []

    response = getattr(exc, "response", None)
    if response is not None:
        try:
            err_json = response.json()
        except Exception:
            err_json = None
        if err_json and "_server_messages" in err_json:
            try:
                for m in json.loads(err_json["_server_messages"]):
                    parsed = json.loads(m) if isinstance(m, str) else m
                    if isinstance(parsed, dict) and parsed.get("message"):
                        messages.append(re.sub("<[^<]+?>", "", parsed["message"]))
            except Exception:
                pass

    if not messages and "ERPNext Rule Failure:" in text:
        messages.append(text.split("ERPNext Rule Failure:", 1)[1].strip())

    return messages


def explain_erp_error(exc: Exception, context: str = "") -> str:
    """Turns a raised exception from an erp_client call into a short,
    plain-language explanation of what went wrong and, where possible,
    what the user can do about it — instead of just relaying a raw
    Python/HTTP exception string.

    `context` is a short label for what was being attempted (e.g.
    "create Lead 'Rahul Sharma'"), used to open the message."""
    text = str(exc)
    prefix = f"Couldn't {context}. " if context else ""

    status_code = getattr(getattr(exc, "response", None), "status_code", None)
    server_messages = _extract_server_messages(exc)
    detail = "; ".join(server_messages) if server_messages else text
    # Classify primarily on what ERPNext's own message actually says
    # (server_messages, when present) rather than on Python exception
    # class names or the HTTP status code — Frappe's JSON message text
    # for a missing-field error reads like "Territory is mandatory", not
    # a class name like "MandatoryError", and a 417 can wrap ANY kind of
    # validation failure on this project's dev server (see erp_client's
    # comment on the Expect:100-continue workaround), so it's checked
    # last, only once nothing more specific was found.
    haystack = (detail if server_messages else text).lower()

    if isinstance(exc, RuntimeError) and "erp_url is not configured" in text.lower():
        return (
            f"{prefix}The ERPNext connection isn't set up yet — ERP_URL "
            "(and the API key/secret) need to be added to the .env file "
            "before this assistant can reach ERPNext."
        )

    if "mandatory" in haystack or "missing" in haystack or "required" in haystack:
        return (
            f"{prefix}ERPNext rejected this because a required field is "
            f"missing: {detail}. Please provide that and try again."
        )

    if "could not find" in haystack or "linkvalidationerror" in haystack:
        return (
            f"{prefix}One of the values doesn't match an existing record "
            f"in ERPNext: {detail}. Double-check the exact name/spelling "
            "(these link fields need an exact match)."
        )

    if "already exists" in haystack or "duplicate" in haystack:
        return f"{prefix}A record with these details already exists in ERPNext: {detail}."

    if status_code == 403 or "permission" in haystack or "not permitted" in haystack:
        return (
            f"{prefix}ERPNext refused this — the API user doesn't have "
            "permission for this action. This usually needs a role/"
            "permission change on the ERPNext side, not a retry."
        )

    if "connectionerror" in haystack or "timeout" in haystack or "timed out" in haystack:
        return (
            f"{prefix}Couldn't reach ERPNext — it may be offline or "
            "unreachable from here. Check that the ERPNext server is "
            "running and ERP_URL in .env points to the right address."
        )

    if server_messages:
        return f"{prefix}ERPNext rejected this: {detail}."

    if status_code == 417:
        return (
            f"{prefix}ERPNext's dev server rejected the request format "
            "(HTTP 417). This is a known local-dev quirk, not necessarily "
            "a data problem — try again, and if it persists the backend "
            "may need restarting."
        )

    return f"{prefix}Something went wrong talking to ERPNext: {text}"


def safe_call(label: str, fn):
    """Drop-in replacement for the `_safe_call(label, fn)` helper
    duplicated across ERP/tools/*_write_tools.py and
    ERP_Unified/tools.py — runs `fn`, and on any exception returns
    explain_erp_error()'s friendly text instead of raising or leaking a
    raw Python exception string to the user."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return explain_erp_error(exc, context=label)
