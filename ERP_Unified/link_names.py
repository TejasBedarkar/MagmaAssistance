"""
ERP_Unified/link_names.py

The model often puts a party into the display field (customer_name on a
Sales Order) instead of the required Link field (customer), which used to
loop the "What is the Customer?" question forever. This fills the Link
field from the *_name value when it points at exactly one record, and
otherwise returns a short "did you mean" hint for the question.
"""

import difflib
import re

from ERP.dynamic_fields import get_required_fields
from ERP.erp_client import erp_client


def _norm(value) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _title_field(target: str) -> str:
    meta = erp_client.get_meta(target)
    return meta.get("title_field") or f"{target.lower().replace(' ', '_')}_name"


def resolve_link(target: str, value: str) -> tuple[str | None, list[str]]:
    """(record ID, []) when `value` matches exactly one `target` record, else (None, close matches)."""
    value = str(value or "").strip()
    if not value:
        return None, []
    if erp_client.get_list(target, fields=["name"], filters=[["name", "=", value]], limit=1, use_cache=False):
        return value, []
    title = _title_field(target)
    rows = erp_client.get_list(target, fields=["name", title], limit=500, use_cache=False)
    wanted = _norm(value)
    same = [r["name"] for r in rows if wanted in (_norm(r.get("name")), _norm(r.get(title)))]
    if len(same) == 1:
        return same[0], []
    labels = {_norm(r.get(title) or r["name"]): r["name"] for r in rows}
    close = difflib.get_close_matches(wanted, list(labels), n=3, cutoff=0.72)
    return None, same or [labels[c] for c in close]


def fill_links_from_names(doctype: str, data: dict) -> tuple[dict, str]:
    """Fills missing required Link fields from their *_name values; returns (data, hint for anything unresolved)."""
    data = dict(data or {})
    hints = []
    for field in get_required_fields(doctype):
        fieldname, target = field["fieldname"], field.get("options")
        named = data.get(f"{fieldname}_name")
        if field.get("fieldtype") != "Link" or not target or data.get(fieldname) or not named:
            continue
        found, suggestions = resolve_link(target, named)
        if found:
            data[fieldname] = found
        elif suggestions:
            hints.append(f"No {target} is called '{named}'. Did you mean: {', '.join(suggestions)}?")
        else:
            hints.append(f"No {target} called '{named}' exists in MagnaERP yet.")
    return data, " ".join(hints)
