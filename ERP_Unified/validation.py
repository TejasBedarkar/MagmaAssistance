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
        pass  # Ignore meta/fuzzy fetch errors and fall back to None

    return None


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
