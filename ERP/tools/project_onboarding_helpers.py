"""
ERP/tools/project_onboarding_helpers.py

Helper functions for project onboarding and batch task management workflows:
company resolution, assignee lookup, field requirement checks, and doc key helpers.
"""

import re
from typing import Any, Dict, List, Optional

from ERP.erp_client import erp_client
from ERP.dynamic_fields import (
    missing_required_fields,
    apply_default_values,
)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Resolved once per process and reused -- which Company a new record
# should belong to almost never changes mid-session, and re-checking it
# on every call would be a wasted round trip.
_DEFAULT_COMPANY_CACHE: Dict[str, Any] = {"resolved": False, "value": None}


def _default_company() -> Optional[str]:
    """Best-effort resolution of 'the' Company a new record should
    belong to, for sites where `company` is required but wasn't given
    explicitly.

    Resolution order:
      1. Global Defaults' `default_company` -- the site-wide default
         used when nothing more specific is set.
      2. If exactly one Company record exists at all, use it -- on a
         single-company install (the common case) there's nothing to
         disambiguate.
    Returns None (never guesses) if neither resolves cleanly, e.g. a
    genuinely multi-company site with no default set -- callers should
    ask for an explicit `company` value in that case, not pick one.
    """
    if _DEFAULT_COMPANY_CACHE["resolved"]:
        return _DEFAULT_COMPANY_CACHE["value"]

    company = None
    try:
        defaults = erp_client.get_doc("Global Defaults", "Global Defaults")
        company = defaults.get("default_company") or None
    except Exception:  # noqa: BLE001
        company = None

    if not company:
        try:
            companies = erp_client.get_list("Company", fields=["name"], limit=2, use_cache=False)
            if len(companies) == 1:
                company = companies[0]["name"]
        except Exception:  # noqa: BLE001
            company = None

    _DEFAULT_COMPANY_CACHE["resolved"] = True
    _DEFAULT_COMPANY_CACHE["value"] = company
    return company


def _company_hint() -> str:
    """A short ' Available companies are: X, Y.' suffix for error
    messages, so a genuinely-ambiguous multi-company site gets pointed
    straight at the valid values instead of just being told 'missing'."""
    try:
        companies = erp_client.get_list("Company", fields=["name"], limit=10, use_cache=False)
    except Exception:  # noqa: BLE001
        return ""
    names = [c["name"] for c in companies if c.get("name")]
    if not names:
        return ""
    noun = "company is" if len(names) == 1 else "companies are"
    return f" Available {noun}: {', '.join(names)}."


def _fill_default_company(doctype: str, data: dict) -> dict:
    """Returns a copy of `data` with `company` auto-filled via
    _default_company() if -- and only if -- `doctype`'s live schema
    actually requires a `company` Link field and `data` doesn't already
    have one. Leaves everything else untouched."""
    if data.get("company"):
        return dict(data)
    try:
        from ERP.dynamic_fields import get_required_fields
        required = get_required_fields(doctype)
    except Exception:  # noqa: BLE001
        return dict(data)

    needs_company = any(
        f["fieldname"] == "company" and f.get("fieldtype") == "Link" for f in required
    )
    if not needs_company:
        return dict(data)

    filled = dict(data)
    resolved = _default_company()
    if resolved:
        filled["company"] = resolved
    return filled


def _first_present(doc: dict, *keys: str) -> Optional[str]:
    """Returns the first non-empty value among `keys` in `doc`. The
    Sales App's custom Lead doctype and a stock ERPNext CRM Lead don't
    necessarily use the same fieldnames (e.g. 'email' vs 'email_id'), so
    every lookup below tries a couple of reasonable candidates instead
    of assuming one exact schema."""
    for key in keys:
        value = doc.get(key)
        if value not in (None, "", []):
            return value
    return None


def _resolve_assignee(identifier: str) -> Dict[str, Any]:
    """Turns a team member reference (an email already, or a plain name
    like 'Rahul' / 'Rahul Sharma') into an ERPNext user ID (their login
    email), which is what assign_to.add requires in `assign_to`.

    Returns {"user": <id>} on a clean match, or {"error": <message>} if
    it's already an email (nothing to resolve), not found, or
    ambiguous -- callers should skip assigning that one task on error
    rather than guessing."""
    identifier = (identifier or "").strip()
    if not identifier:
        return {"error": "No assignee given."}

    if _EMAIL_RE.match(identifier):
        return {"user": identifier}

    # 1. Try fetching exact Employee by ID (e.g. HR-EMP-0001)
    try:
        emp = erp_client.get_doc("Employee", identifier)
        if emp and emp.get("user_id"):
            return {"user": emp["user_id"]}
        elif emp:
            return {"error": f"Employee '{identifier}' found but has no linked User ID (system login)."}
    except Exception:
        pass  # Not an exact Employee ID, proceed to search

    # 2. Try searching User by full name
    try:
        matches = erp_client.get_list(
            "User",
            fields=["name", "full_name"],
            filters=[["full_name", "like", f"%{identifier}%"], ["enabled", "=", 1]],
            limit=5,
            use_cache=False,
        )
    except Exception as exc:  # noqa: BLE001
        return {"error": f"could not look up ERPNext user '{identifier}': {exc}"}

    if matches:
        if len(matches) > 1:
            names = ", ".join(f"{m.get('full_name')} <{m.get('name')}>" for m in matches)
            return {"error": f"'{identifier}' matches more than one ERPNext user ({names}) -- use exact email"}
        return {"user": matches[0]["name"]}

    # 3. If no User matches, try searching Employee by employee_name
    try:
        emp_matches = erp_client.get_list(
            "Employee",
            fields=["name", "employee_name", "user_id"],
            filters=[["employee_name", "like", f"%{identifier}%"], ["status", "=", "Active"]],
            limit=5,
            use_cache=False,
        )
    except Exception as exc:
        return {"error": f"no User found, and Employee lookup failed: {exc}"}

    if not emp_matches:
        return {"error": f"no ERPNext User or active Employee found matching '{identifier}'"}
    if len(emp_matches) > 1:
        names = ", ".join(f"{m.get('employee_name')} <{m.get('name')}>" for m in emp_matches)
        return {"error": f"'{identifier}' matches more than one Employee ({names})"}

    user_id = emp_matches[0].get("user_id")
    if not user_id:
        return {"error": f"Employee '{emp_matches[0].get('employee_name')}' found but has no linked User ID."}

    return {"user": user_id}


def _check_required(doctype: str, data: dict) -> Optional[str]:
    """Returns a human-readable 'missing fields' message if `data` is
    short of what ERPNext's live schema requires for `doctype`, or None
    if nothing required is missing. Mirrors the same live-schema check
    erp_data_tool's create flow uses (ERP.dynamic_fields), but this
    workflow is a single non-interactive call rather than a multi-turn
    one-field-at-a-time flow, so a shortfall here is surfaced as one
    clear message the caller can fix and retry with, via `data`'s
    `extra_fields`, rather than asked about turn by turn."""
    data = apply_default_values(doctype, data)
    missing = missing_required_fields(doctype, data)
    if not missing:
        return None
    labels = ", ".join(f"{f['label']} ({f['fieldname']})" for f in missing)
    message = f"{doctype} is missing required field(s): {labels}."
    if any(f["fieldname"] == "company" for f in missing):
        message += _company_hint()
    return message
