"""
ERP_Unified/validation.py

Data validation, link resolution, warning construction, and query filter
normalization for ERP_Unified tools.
"""

import re
from typing import Optional

from ERP.erp_client import erp_client

_EMAIL_RE = re.compile(
    r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+"
    r"[A-Z]{2,63}$",
    re.IGNORECASE,
)

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
        if len(fuzzy_matches) == 1:
            return fuzzy_matches[0]["name"]
    except Exception:
        pass

    return None


def _prepare_write_data(doctype: str, data: Optional[dict]) -> tuple[dict, list[str]]:
    """Validate model-produced values against the live ERPNext schema."""
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
        except Exception:
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

        if fieldtype == "Table":
            if not isinstance(value, list):
                cleaned.pop(fieldname, None)
                warnings.append(
                    f"Omitted {fieldname} because it requires a list of table rows, but a {type(value).__name__} was provided."
                )

    return cleaned, warnings


def _with_warnings(message: str, warnings: list[str]) -> str:
    if not warnings:
        return message
    return message + "\nValidation adjustments: " + " ".join(warnings)


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
                key = str(v[0]).lower().replace(" ", "").replace("_", "").replace("-", "")
                normalized.append([k, _OPERATOR_MAP.get(key, str(v[0])), v[1]])
            elif isinstance(v, (list, tuple)) and len(v) >= 3:
                normalized.append(list(v))
            else:
                normalized.append([k, "=", v])
        elif isinstance(f, dict):
            for k, v in f.items():
                if isinstance(v, (list, tuple)) and len(v) == 2:
                    key = str(v[0]).lower().replace(" ", "").replace("_", "").replace("-", "")
                    normalized.append([k, _OPERATOR_MAP.get(key, str(v[0])), v[1]])
                elif isinstance(v, (list, tuple)) and len(v) >= 3:
                    normalized.append(list(v))
                else:
                    normalized.append([k, "=", v])
        elif isinstance(f, (list, tuple)) and len(f) >= 3:
            field, raw_op, val = f[0], str(f[1]), f[2]
            key = raw_op.lower().replace(" ", "").replace("_", "").replace("-", "")
            clean_op = _OPERATOR_MAP.get(key, raw_op)
            normalized.append([field, clean_op, val])
        else:
            normalized.append(f)
    return normalized
