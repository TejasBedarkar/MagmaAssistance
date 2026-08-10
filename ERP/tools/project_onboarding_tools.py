"""
ERP/tools/project_onboarding_tools.py

Composite "new client onboarding" workflow, built for the exact process
described by the business flow: a web-crawler-created Lead should result
in (1) a Project, (2) one or more Tasks under that Project assigned to
real team members, and (3) an email to the client with the initial
information -- as ONE coherent action, not four separate chat turns.

Why this is its own tool instead of four calls to erp_data_tool /
assign_task / send_document_email:

  server.py's agent_node does exactly ONE round of tool execution per
  user turn (see build_agent_graph(): graph.add_edge("agent", END) --
  there is no loop back to the LLM after tool results come in). That's
  fine for independent calls, but this workflow is *sequential and
  dependent*: you need the newly-created Project's real `name` before
  you can create Tasks under it, and each Task's real `name` before you
  can assign it. The LLM can't discover those intermediate IDs mid-turn
  because all tool_calls in one AIMessage are decided before any of
  them run. Wrapping the whole sequence in one Python function sidesteps
  that limitation entirely -- it's one tool call, but internally it does
  the create -> create -> create -> assign -> assign -> email chain with
  real ERPNext responses available at each step.

ERPNext mechanics used (see erp_client.call_method_post -- the generic
"call any whitelisted Frappe method" helper already in this codebase,
used for both of these):

  - Project / Task creation: erp_client.create_doc(), same standard
    /api/resource/<Doctype> REST endpoint every other write tool here
    uses (see ERP_Unified/tools.py's erp_data_tool 'create' operation).

  - Task assignment: frappe.desk.form.assign_to.add. This is NOT the
    same as PUTting a value into a Task's `_assign` field -- assign_to.add
    is the actual whitelisted method the ERPNext desk's "Assign To"
    button calls. It creates a ToDo record for the assignee, adds them
    to the document's assignment list, and (notify=1) sends ERPNext's
    own built-in assignment notification/email. A raw field update would
    skip the ToDo and the notification entirely.

  - Client email: frappe.core.doctype.communication.email.make. This is
    the same whitelisted method the ERPNext desk's email composer calls.
    It sends through whatever Email Account is already configured on the
    ERPNext site (no SMTP setup needed in this repo) and logs the
    message on the target document's own communication timeline.

Safety / review:

  `dry_run=True` (the default) validates everything -- resolves the
  Lead, checks required Project/Task fields against ERPNext's live
  schema, resolves each assignee -- and returns a full preview of what
  WOULD be created/assigned/sent, without writing or emailing anything.
  The agent should show this preview to the user and only re-call with
  `dry_run=False` after they confirm, since the email step in particular
  sends a real, externally-visible message that can't be recalled.
"""

import json
import re
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.dynamic_fields import (
    missing_required_fields,
    apply_default_values,
    explain_erp_error,
    safe_call as _safe_call,
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

    Why this can't just use apply_default_values() like every other
    required field: ERPNext's `company` field is nearly always required
    for multi-company support, but on most (especially single-company)
    sites its value comes from a *user/site default* (Global Defaults'
    default_company, or a per-user default), NOT a schema-level
    `default` on the field itself -- so the generic field-meta default
    lookup in ERP.dynamic_fields.apply_default_values() never sees it,
    and every create silently demands a value nothing auto-fills.

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


# ---------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------

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

    if not matches:
        return {"error": f"no ERPNext user found matching '{identifier}'"}
    if len(matches) > 1:
        names = ", ".join(f"{m.get('full_name')} <{m.get('name')}>" for m in matches)
        return {"error": f"'{identifier}' matches more than one ERPNext user ({names}) -- use their exact email instead"}

    return {"user": matches[0]["name"]}


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


# ---------------------------------------------------------------------
# The tool
# ---------------------------------------------------------------------

@tool
def onboard_new_lead(
    lead_name: str,
    tasks: List[Dict[str, Any]],
    client_email_subject: str,
    client_email_content: str,
    project_name: Optional[str] = None,
    company: Optional[str] = None,
    client_email_recipients: Optional[List[str]] = None,
    client_email_cc: Optional[List[str]] = None,
    extra_project_fields: Optional[Dict[str, Any]] = None,
    notify_assignees: bool = True,
    dry_run: bool = True,
) -> str:
    """Runs the full new-client onboarding workflow for an existing
    ERPNext Lead in one action: creates a Project for the Lead, creates
    one or more Tasks under it and assigns each to a real team member,
    then emails the client the initial project information. Use this
    instead of separate create/assign/email calls -- those can't be
    chained reliably in one turn because each step needs the previous
    step's real ERPNext-assigned ID.

    `lead_name` is the exact Lead document ID (e.g. 'LEAD-00050') -- use
    get_records/erp_data_tool first if you only have a company/person
    name and need to find it.

    `tasks` is a list of dicts, one per Task to create, each with:
      - "subject" (required): short task title, e.g. "Kickoff call".
      - "assigned_to" (required): the team member's exact ERPNext email,
        OR a plain name (e.g. "Rahul Sharma") which this tool will try
        to resolve to exactly one matching ERPNext user -- if it matches
        zero or more than one user, that task is still created but left
        unassigned, and the reason is reported back to you.
      - "due_date" (optional, YYYY-MM-DD): sets the task's exp_end_date
        and the assignment's ToDo due date.
      - "priority" (optional): "Low" | "Medium" | "High" | "Urgent",
        defaults to "Medium".
      - "description" (optional): longer note, becomes both the Task
        description and the assignee's ToDo note.

    `client_email_subject` / `client_email_content` are the actual email
    to send the client -- draft real, specific content (mention the
    project name, what happens next); this tool does not invent copy.
    `client_email_recipients` defaults to the Lead's own email if not
    given. `project_name` defaults to "<Lead's company> - Onboarding" if
    not given. `company` is the ERPNext Company this Project/Task(s)
    belong to (required on most sites for multi-company support) -- on
    a single-company site this resolves automatically and you normally
    don't need to pass it; only pass it if the tool reports the value
    is ambiguous (more than one Company exists). `extra_project_fields`
    lets you pass any other Project
    fields the site requires beyond what's inferred from the Lead (this
    tool will tell you exactly what's missing if so).

    IMPORTANT: `dry_run` defaults to True. A dry run validates the Lead,
    every Task, every assignee, and the email, and returns a full
    preview WITHOUT creating, assigning, or emailing anything -- show
    this preview to the user first. Only call again with dry_run=False,
    after explicit confirmation, to actually perform it -- the email
    step sends a real message to the client that cannot be recalled."""

    if not lead_name or not lead_name.strip():
        return "A Lead name/ID is required."
    if not tasks:
        return "At least one task is required (each with 'subject' and 'assigned_to')."
    for i, t in enumerate(tasks, start=1):
        if not (t or {}).get("subject"):
            return f"Task #{i} is missing 'subject'."
        if not (t or {}).get("assigned_to"):
            return f"Task #{i} ('{t.get('subject')}') is missing 'assigned_to'."

    # ---- 1. Resolve the Lead -----------------------------------------
    try:
        lead = erp_client.get_doc("Lead", lead_name.strip())
    except Exception as exc:  # noqa: BLE001
        return explain_erp_error(exc, context=f"look up Lead '{lead_name}'")

    company = _first_present(lead, "company", "company_name") or lead_name
    client_email = _first_present(lead, "email", "email_id")
    resolved_project_name = project_name or f"{company} - Onboarding"

    project_data = {"project_name": resolved_project_name, **(extra_project_fields or {})}
    if company:
        project_data.setdefault("company", company)
    # Only set a customer link if the Lead actually carries one -- don't
    # invent a Customer reference that might not exist yet.
    customer_ref = _first_present(lead, "customer", "customer_name")
    if customer_ref and "customer" not in project_data:
        project_data["customer"] = customer_ref
    project_data = _fill_default_company("Project", project_data)

    project_issue = _check_required("Project", project_data)
    if project_issue:
        return (
            f"Can't create the Project yet -- {project_issue} "
            "Pass the missing value(s) via extra_project_fields and try again."
        )

    # ---- 2. Resolve every assignee up front (before writing anything,
    #         so a dry run reports assignment problems too) ------------
    resolved_tasks = []
    for t in tasks:
        assignee = _resolve_assignee(str(t["assigned_to"]))
        task_data = {
            "subject": t["subject"],
            "priority": t.get("priority") or "Medium",
            "description": t.get("description") or "",
        }
        if t.get("due_date"):
            task_data["exp_end_date"] = t["due_date"]
        if project_data.get("company"):
            task_data["company"] = project_data["company"]
        task_data = _fill_default_company("Task", task_data)
        task_issue = _check_required("Task", {**task_data, "project": "placeholder"})
        resolved_tasks.append({
            "input": t, "task_data": task_data,
            "assignee": assignee, "task_issue": task_issue,
        })

    # Recipients for the client email.
    recipients = client_email_recipients or ([client_email] if client_email else [])
    email_issue = None
    if not recipients:
        email_issue = (
            "No client email address was given and none was found on the "
            "Lead -- pass client_email_recipients explicitly."
        )

    # ---- 3. Dry run: report the plan, write nothing -------------------
    if dry_run:
        lines = [f"DRY RUN -- nothing has been created or sent yet. Plan for Lead '{lead_name}':", ""]
        lines.append(f"1. Create Project '{resolved_project_name}' (fields: {json.dumps(project_data, default=str)})")
        for i, rt in enumerate(resolved_tasks, start=1):
            td, a, issue = rt["task_data"], rt["assignee"], rt["task_issue"]
            line = f"2.{i}. Create Task '{td['subject']}'"
            if issue:
                line += f" -- WILL FAIL: {issue}"
            elif "error" in a:
                line += f" -- will be created UNASSIGNED ({a['error']})"
            else:
                due = f", due {td.get('exp_end_date')}" if td.get("exp_end_date") else ""
                line += f", assign to {a['user']}{due}, priority {td['priority']}"
            lines.append(line)
        if email_issue:
            lines.append(f"3. Email client -- WILL FAIL: {email_issue}")
        else:
            lines.append(
                f"3. Email {', '.join(recipients)}"
                + (f" (cc: {', '.join(client_email_cc)})" if client_email_cc else "")
                + f", subject: '{client_email_subject}'"
            )
        lines.append("")
        lines.append("Call this again with dry_run=False (after confirming with the user) to actually run it.")
        return "\n".join(lines)

    # ---- 4. Real run: create Project ----------------------------------
    def create_project():
        return erp_client.create_doc("Project", project_data)

    project_result = _safe_call(f"create Project for Lead '{lead_name}'", create_project)
    if isinstance(project_result, str):  # _safe_call already turned an exception into text
        return f"Stopped -- could not create the Project: {project_result}"
    project_id = project_result.get("name")

    # ---- 5. Real run: create + assign each Task ------------------------
    summary = [f"Project '{project_id}' ({resolved_project_name}) created for Lead '{lead_name}'."]

    for rt in resolved_tasks:
        td, a, issue = rt["task_data"], rt["assignee"], rt["task_issue"]
        subject = td["subject"]

        if issue:
            summary.append(f"- Task '{subject}' NOT created: {issue}")
            continue

        def create_task(td=td):
            return erp_client.create_doc("Task", {**td, "project": project_id})

        task_result = _safe_call(f"create Task '{subject}'", create_task)
        if isinstance(task_result, str):
            summary.append(f"- Task '{subject}' NOT created: {task_result}")
            continue
        task_id = task_result.get("name")

        if "error" in a:
            summary.append(f"- Task '{subject}' ({task_id}) created but NOT assigned: {a['error']}")
            continue

        def do_assign(task_id=task_id, td=td, a=a):
            payload = {
                "assign_to": [a["user"]],
                "doctype": "Task",
                "name": task_id,
                "description": td.get("description") or "",
                "priority": td.get("priority") or "Medium",
                "notify": 1 if notify_assignees else 0,
            }
            if td.get("exp_end_date"):
                payload["date"] = td["exp_end_date"]
            return erp_client.call_method_post("frappe.desk.form.assign_to.add", payload)

        assign_result = _safe_call(f"assign Task '{subject}' to {a['user']}", do_assign)
        if isinstance(assign_result, str) and assign_result.startswith("Couldn't"):
            summary.append(f"- Task '{subject}' ({task_id}) created but assignment FAILED: {assign_result}")
        else:
            due_note = f", due {td['exp_end_date']}" if td.get("exp_end_date") else ""
            summary.append(f"- Task '{subject}' ({task_id}) created and assigned to {a['user']}{due_note}.")

    # ---- 6. Real run: email the client ----------------------------------
    if email_issue:
        summary.append(f"- Client email NOT sent: {email_issue}")
    else:
        def send_email():
            payload = {
                "recipients": recipients,
                "cc": client_email_cc or [],
                "subject": client_email_subject,
                "content": client_email_content,
                "doctype": "Project",
                "name": project_id,
                "send_email": 1,
            }
            return erp_client.call_method_post(
                "frappe.core.doctype.communication.email.make", payload
            )

        email_result = _safe_call(f"email client about Project '{project_id}'", send_email)
        if isinstance(email_result, str) and email_result.startswith("Couldn't"):
            summary.append(f"- Client email NOT sent: {email_result}")
        else:
            summary.append(f"- Client email sent to {', '.join(recipients)}.")

    return "\n".join(summary)


PROJECT_ONBOARDING_TOOLS = [onboard_new_lead]