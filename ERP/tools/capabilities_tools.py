"""
ERP/tools/capabilities_tools.py

A single self-describing tool the agent calls when the user asks
something like "what can you do?", "what tools do you have?", "what are
you able to help with?", etc. Instead of hardcoding a hand-maintained
list (which drifts out of sync as domains get added), it introspects
ERP.tools.ALL_TOOLS at call time and groups tools by domain using a
name-pattern match, so any new create_/update_/get_ tool added to any
domain module automatically shows up here without touching this file.

Import note: this reads `from ERP.tools import ALL_TOOLS` INSIDE the
tool's run() function (not at module top-level). ERP/tools/__init__.py
imports this module while it's still building ALL_TOOLS, so a top-level
import here would be circular; deferring it until the tool actually runs
sidesteps that, since by then the package has finished loading.

Add this list to ERP/tools/__init__.py:
    from .capabilities_tools import CAPABILITY_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *LEAD_TOOLS, *CAPABILITY_TOOLS, ...]
"""

from langchain_core.tools import tool

# Shared with ERP/tools/*_write_tools.py and ERP_Unified/tools.py — turns
# an exception into a plain-language explanation instead of a raw
# Python/HTTP error string. list_capabilities never touches ERPNext so
# it never actually raises, but describe_doctype_fields below does call
# erp_client.get_meta(), so this matters there.
from ERP.dynamic_fields import safe_call as _safe_call


# Ordered most-specific-first so e.g. "sales_order" is matched before a
# more generic "sales" pattern would grab it. Each entry:
# (label shown to the user, tuple of substrings to look for in the tool name).
DOMAIN_PATTERNS = [
    ("Sales Orders", ("sales_order",)),
    ("Sales Invoices", ("sales_invoice",)),
    ("Quotations", ("quotation",)),
    ("Opportunities", ("opportunity",)),
    ("Leads", ("lead",)),
    ("Customers", ("customer",)),
    ("Contacts", ("contact",)),
    ("Purchase Orders", ("purchase_order",)),
    ("Purchase Invoices", ("purchase_invoice",)),
    ("Suppliers", ("supplier",)),
    ("Material Requests", ("material_request",)),
    ("Work Orders", ("work_order",)),
    ("Production Plans", ("production_plan",)),
    ("Job Cards", ("job_card",)),
    ("Stock Movements", ("stock_entry",)),
    ("Items", ("item",)),
    ("Employees", ("employee",)),
    ("Leave", ("leave",)),
    ("Attendance", ("attendance",)),
    ("Payments", ("payment",)),
    ("Journal Entries", ("journal",)),
]

ACTION_PREFIXES = {
    "create": "add",
    "update": "update",
    "get": "look up",
    "fetch": "look up",
    "list": "look up",
}


def _classify(tool_name: str) -> str:
    """Maps a tool name to a short domain label using DOMAIN_PATTERNS."""
    for label, keywords in DOMAIN_PATTERNS:
        if any(keyword in tool_name for keyword in keywords):
            return label
    return "Other"


def _action(tool_name: str) -> str:
    """Maps a tool's name prefix (create_/update_/get_/...) to a plain
    verb. Falls back to 'work with' for anything that doesn't follow the
    create_/update_/get_ naming convention."""
    prefix = tool_name.split("_", 1)[0]
    return ACTION_PREFIXES.get(prefix, "work with")


@tool
def list_capabilities():
    """Tells the user what this assistant can do — the full range of
    supported actions across the connected ERPNext system. Use this
    whenever the user asks things like 'what can you do?', 'what are
    your tools?', 'what are you capable of?', 'what can you help me
    with?', 'what's in your range?', or similar general
    capability/help questions. Takes no arguments."""

    def run():
        from ERP.tools import ALL_TOOLS  # deferred: avoids circular import at module load time

        groups: dict[str, set[str]] = {}
        for t in ALL_TOOLS:
            if t.name == "list_capabilities":
                continue
            label = _classify(t.name)
            groups.setdefault(label, set()).add(_action(t.name))

        # Keep a stable, readable order: DOMAIN_PATTERNS order first,
        # then anything uncategorized ("Other") last.
        ordered_labels = [label for label, _ in DOMAIN_PATTERNS if label in groups]
        if "Other" in groups:
            ordered_labels.append("Other")

        action_order = ["add", "update", "look up", "work with"]
        lines = []
        for label in ordered_labels:
            actions = sorted(groups[label], key=lambda a: action_order.index(a) if a in action_order else 99)
            lines.append(f"- {label}: {', '.join(actions)}")

        summary = (
            "Here's what I can help with in ERPNext:\n"
            + "\n".join(lines)
            + "\n\nJust tell me what you'd like done (e.g. 'create a lead for "
            "Rahul Sharma' or 'what are our pending sales orders?') and I'll "
            "use the right tool for it."
        )
        return summary

    return _safe_call("list capabilities", run)


@tool
def describe_doctype_fields(doctype: str) -> str:
    """Looks up, LIVE from ERPNext's own schema, which fields are
    required to create a record of any given doctype (e.g. 'Lead',
    'Sales Order', 'Item', 'Employee', or any other ERPNext doctype —
    including ones with no dedicated create_/update_ tool). Use this
    when you need to ask the user for information one field at a time
    before calling a create tool, or when the user asks something like
    'what do you need to create a <doctype>?' or 'what fields does
    <doctype> need?'. This never guesses — it reflects whatever the
    live ERPNext site actually requires right now, including any
    site-specific customizations."""

    def run():
        from ERP.dynamic_fields import get_required_fields, field_question

        fields = get_required_fields(doctype)
        if not fields:
            return (
                f"ERPNext's schema doesn't mark any field as strictly "
                f"required to create a {doctype} — go ahead and create "
                "one with whatever details the user gave."
            )

        lines = [f"To create a {doctype}, ERPNext requires:"]
        for f in fields:
            note = " (needs structured line items, not a single answer)" if f["is_table"] else ""
            lines.append(f"- {f['label']} ({f['fieldname']}){note}: {field_question(f)}")
        lines.append(
            "\nAsk the user for these one at a time rather than all at "
            "once, and only proceed once every required field has an answer."
        )
        return "\n".join(lines)

    return _safe_call(f"look up required fields for {doctype}", run)


CAPABILITY_TOOLS = [list_capabilities, describe_doctype_fields]

# No mandatory fields to slot-fill and no answers need special parsing —
# kept here only for consistency with the other domain modules, since
# ERP/tools/__init__.py merges every module's REQUIRED_FIELDS/FIELD_PARSERS.
REQUIRED_FIELDS = {}
FIELD_PARSERS = {}