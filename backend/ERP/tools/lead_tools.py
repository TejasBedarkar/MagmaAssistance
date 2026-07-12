"""
ERP/tools/lead_tools.py

Read-only Lead queries, backed by ERPNext's standard REST API via
ERP/erp_client.py — same doctype-resource approach as sales_tools.py.

This file exists specifically to fill a gap: sales_write_tools.py has
create_lead/update_lead but nothing to *read* leads. Without a matching
read tool, ToolRAG has nothing relevant to retrieve for questions like
"how many open leads do we have", the request falls through to the
plain (no-tools) chain, and a tool-calling-tuned local model like
llama3.2 will sometimes hallucinate a fake tool-call-shaped JSON string
as its text reply instead of admitting it has nothing to call. Registering
real lead-read tools here is what stops that.

Same conventions as sales_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — ERP/network failures are caught and turned into a
    short string the LLM can relay honestly.
  - read-only; no create/update logic here (see sales_write_tools.py).

Add this list to ERP/tools/__init__.py:
    from .lead_tools import LEAD_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *LEAD_TOOLS]
"""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client

DEFAULT_LIST_LIMIT = 10
# High enough to treat as "all leads" for local counting, same pattern
# get_sales_summary uses for order aggregates — ERPNext's REST list API
# doesn't expose a dedicated count endpoint, so this counts client-side.
COUNT_FETCH_LIMIT = 5000


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason (network, auth, bad doctype, etc.)."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not fetch {label} from ERPNext right now ({exc})."


def _default(value, fallback):
    """See sales_tools.py's _default — resolves an Optional[...] arg to
    its real default inside the function body, so small local models
    passing an explicit `null` don't trip Pydantic validation."""
    return fallback if value is None else value


@tool
def get_leads(limit: Optional[int] = None):
    """Get the most recent leads, including name, company, status, and
    contact details. Use for questions like 'show recent leads' or
    'list our leads'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        leads = erp_client.get_list(
            "Lead",
            fields=["name", "lead_name", "company_name", "status", "email_id", "mobile_no"],
            order_by="creation desc",
            limit=limit,
        )
        return str(leads)

    return _safe_call("leads", run)


@tool
def get_lead_details(lead_id: str):
    """Get full details of one specific lead by its ID/name (e.g.
    'LEAD-00001'), including contact info, status, and notes."""

    def run():
        return str(erp_client.get_doc("Lead", lead_id))

    return _safe_call(f"lead {lead_id}", run)


@tool
def get_open_leads(limit: Optional[int] = None):
    """Get leads that are still open — not yet converted, lost, or
    marked do-not-contact (status 'Open' or 'Lead'). Use for questions
    like 'what leads are still open' or 'show unconverted leads'."""
    limit = _default(limit, DEFAULT_LIST_LIMIT)

    def run():
        leads = erp_client.get_list(
            "Lead",
            fields=["name", "lead_name", "company_name", "status", "email_id", "mobile_no"],
            filters=[["status", "in", ["Open", "Lead"]]],
            order_by="creation desc",
            limit=limit,
        )
        return str(leads)

    return _safe_call("open leads", run)


@tool
def get_lead_count(status: Optional[str] = None):
    """Get the total number of leads, optionally filtered by status
    (e.g. 'Open', 'Contacted', 'Replied', 'Converted', 'Do Not
    Contact'). Use for questions like 'how many open leads do we have',
    'how many leads total', or 'how many leads have converted'."""

    def run():
        filters = [["status", "=", status]] if status else None
        leads = erp_client.get_list(
            "Lead",
            fields=["name"],
            filters=filters,
            limit=COUNT_FETCH_LIMIT,
        )
        scope = f" with status '{status}'" if status else ""
        return f"{len(leads)} lead(s){scope}."

    return _safe_call("lead count", run)


LEAD_TOOLS = [
    get_leads,
    get_lead_details,
    get_open_leads,
    get_lead_count,
]