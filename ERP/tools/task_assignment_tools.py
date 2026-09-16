"""
ERP/tools/task_assignment_tools.py

A dedicated, safe way to assign/reassign an EXISTING Task to a real team
member. Two real bugs motivated this file (found live-testing task
assignment): (1) Task has no 'assigned_to' field -- assignment is a
separate Frappe mechanism (frappe.desk.form.assign_to.add), so looping
erp_data_tool 'update' calls with a fake field silently strips it and
fails with "no valid fields remain"; (2) the write-approval gate only
tracks one pending action per session, so stacking N separate
erp_data_tool proposals in one turn means a single "yes" only ever has a
chance to execute the last one. Batching reassignment into one tool call,
the same way batch_manage_project_tasks batches creation, fixes both.
"""

from typing import Any, Dict, List

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.dynamic_fields import safe_call as _safe_call
from ERP.tools.project_onboarding_tools import _resolve_assignee


@tool
def reassign_tasks(
    tasks: List[Dict[str, Any]],
    notify_assignees: bool = True,
    dry_run: bool = True,
) -> str:
    """Assigns one or more EXISTING Tasks to real team members in one action.
    Use this to fix a Task that was created but left unassigned (the
    intended assignee didn't resolve to a real person the first time), or
    to reassign a Task to someone else. Do NOT try to set an 'assigned_to'
    field via erp_data_tool's update operation -- Task has no such field.

    `tasks` is a list of dicts, one per Task to (re)assign, each with:
      - "task_name" (required): the exact Task ID (e.g. 'TASK-2026-00008').
        NEVER invent or guess a Task ID -- only use one you already know is
        real, because it was just returned by a create/list/get call in
        this conversation, or the user gave it to you directly. If you
        don't have a real Task ID, look it up first (e.g. via
        erp_data_tool's list/get) or ask the user, instead of calling this
        tool with a made-up ID.
      - "assigned_to" (required): the team member's exact ERPNext email, OR
        a plain name this tool will try to resolve to exactly one matching
        ERPNext user. NEVER invent or guess a person's name here -- if you
        don't already know a real name from this conversation or the ERP
        data, ask the user who to assign it to instead of making one up.

    IMPORTANT: `dry_run` defaults to True. A dry run resolves every
    assignee and returns a full preview WITHOUT assigning anything. Show
    this preview to the user first. Only call again with dry_run=False,
    after explicit confirmation, to actually perform it."""

    if not tasks:
        return "At least one task is required (each with 'task_name' and 'assigned_to')."

    resolved = []
    for i, t in enumerate(tasks, start=1):
        if not (t or {}).get("task_name"):
            return f"Task #{i} is missing 'task_name'."
        if not (t or {}).get("assigned_to"):
            return f"Task #{i} ('{t.get('task_name')}') is missing 'assigned_to'."

        task_name = str(t["task_name"]).strip()
        try:
            task_doc = erp_client.get_doc("Task", task_name)
        except Exception as exc:  # noqa: BLE001
            resolved.append({"task_name": task_name, "error": f"could not find Task '{task_name}': {exc}"})
            continue

        assignee = _resolve_assignee(str(t["assigned_to"]))
        resolved.append({"task_name": task_name, "subject": task_doc.get("subject"), "assignee": assignee})

    if dry_run:
        lines = ["DRY RUN -- nothing has been assigned yet:", ""]
        for r in resolved:
            if r.get("error"):
                lines.append(f"- {r['task_name']}: WILL FAIL -- {r['error']}")
            elif "error" in r["assignee"]:
                lines.append(f"- {r['task_name']} ('{r.get('subject')}'): WILL FAIL -- {r['assignee']['error']}")
            else:
                lines.append(f"- {r['task_name']} ('{r.get('subject')}'): assign to {r['assignee']['user']}")
        lines.append("")
        lines.append("Call this again with dry_run=False (after confirming with the user) to actually run it.")
        return "\n".join(lines)

    summary = []
    for r in resolved:
        if r.get("error"):
            summary.append(f"- {r['task_name']}: NOT assigned -- {r['error']}")
            continue
        a = r["assignee"]
        if "error" in a:
            summary.append(f"- {r['task_name']} ('{r.get('subject')}'): NOT assigned -- {a['error']}")
            continue

        def do_assign(task_name=r["task_name"], a=a):
            payload = {
                "assign_to": [a["user"]],
                "doctype": "Task",
                "name": task_name,
                "notify": 1 if notify_assignees else 0,
            }
            return erp_client.call_method_post("frappe.desk.form.assign_to.add", payload)

        assign_result = _safe_call(f"assign Task '{r['task_name']}' to {a['user']}", do_assign)
        if isinstance(assign_result, str) and assign_result.startswith("Couldn't"):
            summary.append(f"- {r['task_name']}: assignment FAILED -- {assign_result}")
        else:
            summary.append(f"- {r['task_name']} ('{r.get('subject')}') assigned to {a['user']}.")

    return "\n".join(summary)


TASK_ASSIGNMENT_TOOLS = [reassign_tasks]
