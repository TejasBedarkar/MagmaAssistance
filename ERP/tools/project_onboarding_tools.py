"""
ERP/tools/project_onboarding_tools.py

Simple Sales Order -> Project -> Tasks -> User Assignment workflow for ERPNext v16.

Workflow:
    Sales Order
        -> read Customer + Company
        -> create Project linked to Sales Order
        -> add Task assignees to Project Users
        -> create ALL requested Tasks under the same Project
        -> assign each Task by creating a ToDo

No email is sent by this workflow.

Important:
- Project.project_name is unique in standard ERPNext, so an already-used
  project name cannot be reused.
- Task.subject is NOT unique in standard ERPNext v16. Multiple Tasks can
  exist in the same Project and the same subject can technically be reused.
  If the user's site reports a unique-subject error, that is likely a custom
  validation/customization on that ERPNext site.
"""

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

_DEFAULT_COMPANY_CACHE: Dict[str, Any] = {
    "resolved": False,
    "value": None,
}


def _default_company() -> Optional[str]:
    """Resolve the site's default Company without guessing on multi-company sites."""
    if _DEFAULT_COMPANY_CACHE["resolved"]:
        return _DEFAULT_COMPANY_CACHE["value"]

    company = None

    try:
        defaults = erp_client.get_doc(
            "Global Defaults",
            "Global Defaults",
            use_cache=False,
        )
        company = defaults.get("default_company") or None
    except Exception:
        company = None

    if not company:
        try:
            companies = erp_client.get_list(
                "Company",
                fields=["name"],
                limit=2,
                use_cache=False,
            )
            if len(companies) == 1:
                company = companies[0].get("name")
        except Exception:
            company = None

    _DEFAULT_COMPANY_CACHE["resolved"] = True
    _DEFAULT_COMPANY_CACHE["value"] = company
    return company


def _company_hint() -> str:
    try:
        companies = erp_client.get_list(
            "Company",
            fields=["name"],
            limit=20,
            use_cache=False,
        )
    except Exception:
        return ""

    names = [row.get("name") for row in companies if row.get("name")]
    if not names:
        return ""

    noun = "company is" if len(names) == 1 else "companies are"
    return f" Available {noun}: {', '.join(names)}."


def _fill_default_company(doctype: str, data: dict) -> dict:
    """Fill company only when the live schema requires it."""
    if data.get("company"):
        return dict(data)

    try:
        from ERP.dynamic_fields import get_required_fields

        required = get_required_fields(doctype)
    except Exception:
        return dict(data)

    needs_company = any(
        field.get("fieldname") == "company"
        and field.get("fieldtype") == "Link"
        for field in required
    )

    if not needs_company:
        return dict(data)

    result = dict(data)
    company = _default_company()

    if company:
        result["company"] = company

    return result


def _check_required(doctype: str, data: dict) -> Optional[str]:
    """Return a readable list of missing required fields."""
    data = apply_default_values(doctype, data)
    missing = missing_required_fields(doctype, data)

    if not missing:
        return None

    labels = ", ".join(
        f"{field['label']} ({field['fieldname']})"
        for field in missing
    )

    message = f"{doctype} is missing required field(s): {labels}."

    if any(field["fieldname"] == "company" for field in missing):
        message += _company_hint()

    return message


def _resolve_user(identifier: str) -> Dict[str, Any]:
    """
    Resolve an enabled ERPNext User from:
      - exact login/email
      - exact full name
      - unique partial full-name match
    """
    identifier = (identifier or "").strip()

    if not identifier:
        return {"error": "No user was supplied."}

    if _EMAIL_RE.match(identifier):
        try:
            users = erp_client.get_list(
                "User",
                fields=["name", "full_name", "enabled"],
                filters=[
                    ["name", "=", identifier],
                    ["enabled", "=", 1],
                ],
                limit=1,
                use_cache=False,
            )
        except Exception as exc:
            return {
                "error": f"could not validate ERPNext user '{identifier}': {exc}"
            }

        if users:
            return {"user": users[0]["name"]}

        return {
            "error": f"no enabled ERPNext user exists with email '{identifier}'"
        }

    try:
        exact = erp_client.get_list(
            "User",
            fields=["name", "full_name", "enabled"],
            filters=[
                ["full_name", "=", identifier],
                ["enabled", "=", 1],
            ],
            limit=5,
            use_cache=False,
        )

        if len(exact) == 1:
            return {"user": exact[0]["name"]}

        if len(exact) > 1:
            matches = ", ".join(
                f"{row.get('full_name')} <{row.get('name')}>"
                for row in exact
            )
            return {
                "error": (
                    f"'{identifier}' matches more than one ERPNext user: "
                    f"{matches}. Use the exact email."
                )
            }

        matches = erp_client.get_list(
            "User",
            fields=["name", "full_name", "enabled"],
            filters=[
                ["full_name", "like", f"%{identifier}%"],
                ["enabled", "=", 1],
            ],
            limit=5,
            use_cache=False,
        )
    except Exception as exc:
        return {
            "error": f"could not look up ERPNext user '{identifier}': {exc}"
        }

    if not matches:
        return {
            "error": f"no enabled ERPNext user found matching '{identifier}'"
        }

    if len(matches) > 1:
        names = ", ".join(
            f"{row.get('full_name')} <{row.get('name')}>"
            for row in matches
        )
        return {
            "error": (
                f"'{identifier}' matches more than one ERPNext user "
                f"({names}). Use the exact email."
            )
        }

    return {"user": matches[0]["name"]}


def _unique_users(values: List[str]) -> tuple[List[str], Optional[str]]:
    """Resolve and de-duplicate Project Users."""
    resolved: List[str] = []
    seen = set()

    for value in values:
        result = _resolve_user(str(value))

        if "error" in result:
            return [], result["error"]

        user = result["user"]

        if user not in seen:
            seen.add(user)
            resolved.append(user)

    return resolved, None


def _todo_priority(task_priority: str) -> str:
    """Map Task priority to ToDo priority."""
    priority = (task_priority or "Medium").strip()

    if priority == "Urgent":
        return "High"

    if priority not in {"Low", "Medium", "High"}:
        return "Medium"

    return priority


def _assignment_exists(task_id: str, user: str) -> bool:
    """Avoid duplicate open ToDos for the same Task/user."""
    rows = erp_client.get_list(
        "ToDo",
        fields=["name"],
        filters=[
            ["reference_type", "=", "Task"],
            ["reference_name", "=", task_id],
            ["allocated_to", "=", user],
            ["status", "=", "Open"],
        ],
        limit=1,
        use_cache=False,
    )

    return bool(rows)


def _assign_task_without_email(
    task_id: str,
    user: str,
    description: str,
    priority: str,
    due_date: Optional[str],
) -> Dict[str, Any]:
    """
    Assign a Task without using frappe.desk.form.assign_to.add.

    Creating the ToDo directly avoids the assignment notification/email
    generated by the normal Assign To action.
    """
    try:
        if _assignment_exists(task_id, user):
            return {
                "ok": True,
                "already_assigned": True,
            }
    except Exception:
        # If the duplicate-check itself fails, continue with creation.
        pass

    todo_data = {
        "allocated_to": user,
        "reference_type": "Task",
        "reference_name": task_id,
        "description": (
            description.strip()
            if description and description.strip()
            else f"Assignment for Task {task_id}"
        ),
        "priority": _todo_priority(priority),
        "status": "Open",
    }

    if due_date:
        todo_data["date"] = due_date

    try:
        result = erp_client.create_doc("ToDo", todo_data)

        return {
            "ok": True,
            "already_assigned": False,
            "todo": result,
        }

    except Exception as exc:
        return {
            "ok": False,
            "error": explain_erp_error(
                exc,
                context=f"assign Task '{task_id}' to '{user}'",
            ),
        }


def _normalize_tasks(tasks: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Normalize ALL tasks from the AI input.

    There is intentionally no uniqueness check on task subjects.
    Multiple tasks are expected and are created one-by-one.
    """
    if not tasks:
        return [], "At least one task is required."

    normalized: List[Dict[str, Any]] = []

    for index, raw_task in enumerate(tasks, start=1):
        task = raw_task or {}

        subject = str(task.get("subject") or "").strip()
        assigned_to = str(task.get("assigned_to") or "").strip()

        if not subject:
            return [], f"Task #{index} is missing 'subject'."

        if not assigned_to:
            return [], f"Task #{index} ('{subject}') is missing 'assigned_to'."

        normalized.append(
            {
                "subject": subject,
                "assigned_to": assigned_to,
                "due_date": task.get("due_date"),
                "priority": task.get("priority") or "Medium",
                "description": task.get("description") or "",
                "expected_start_date": task.get("expected_start_date"),
            }
        )

    return normalized, None


@tool
def create_project_for_sales_order(
    tasks: List[Dict[str, Any]],
    sales_order_id: Optional[str] = None,
    project_name: Optional[str] = None,
    project_users: Optional[List[str]] = None,
    expected_start_date: Optional[str] = None,
    expected_end_date: Optional[str] = None,
    priority: Optional[str] = None,
    project_type: Optional[str] = None,
    department: Optional[str] = None,
    extra_project_fields: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Create a Project, optionally linked to a Sales Order, and create
    MULTIPLE Tasks under that Project.

    This is the preferred tool for requests such as:

      "Create a project for Sales Order SO-00025 and create these tasks:
       Design, Development and Testing. Assign Design to Rahul,
       Development to Amit and Testing to Rahul."

    IMPORTANT FOR TASKS:
    - `tasks` is a LIST.
    - Create one dictionary for EVERY requested task.
    - NEVER stop after the first task.
    - Different tasks in the same Project are completely supported.
    - Do NOT tell the user that Task subjects must be unique. Standard
      ERPNext v16 does NOT mark Task.subject as unique.

    Each task dictionary contains:
      - subject: required task title
      - assigned_to: required ERPNext User email or full name
      - due_date: optional YYYY-MM-DD
      - priority: optional Low / Medium / High / Urgent
      - description: optional task description
      - expected_start_date: optional YYYY-MM-DD or datetime

    Project behavior:
      - If a Sales Order is supplied, reads Customer automatically from it.
      - If a Sales Order is supplied, reads Company automatically from it.
      - If a Sales Order is supplied, sets Project.customer = Sales Order.customer.
      - If a Sales Order is supplied, sets Project.sales_order = the supplied Sales Order ID.
      - If a Sales Order is supplied, updates Sales Order.project to the new
        Project ID so both documents are linked.
      - If no Sales Order is supplied, creates a standalone Project using the
        provided project name and optional extra fields.
      - Adds all Task assignees to Project.users.
      - Additional users can be supplied with `project_users`.

    No email is sent.
    No confirmation/dry-run is used.
    """

    sales_order_id = (sales_order_id or "").strip()

    normalized_tasks, task_error = _normalize_tasks(tasks)

    if task_error:
        return task_error

    sales_order = None
    customer = None
    sales_company = None

    # ---------------------------------------------------------------
    # 1. Optionally Read Sales Order
    # ---------------------------------------------------------------
    if sales_order_id:
        try:
            sales_order = erp_client.get_doc(
                "Sales Order",
                sales_order_id,
                use_cache=False,
            )
        except Exception as exc:
            return explain_erp_error(
                exc,
                context=f"look up Sales Order '{sales_order_id}'",
            )

        customer = sales_order.get("customer")
        sales_company = sales_order.get("company")

        if not customer:
            return (
                f"Sales Order '{sales_order_id}' does not contain a Customer. "
                "The Customer is required to create the Project."
            )

        # ERPNext's standard Sales Order -> Project action is intended for a
        # submitted Sales Order. Keep this check aligned with that normal flow.
        if sales_order.get("docstatus") not in (None, 1):
            return (
                f"Sales Order '{sales_order_id}' is not submitted. "
                "Submit the Sales Order first, then create the Project."
            )

        # If the Sales Order is already linked to a Project, do not create a
        # second Project accidentally.
        existing_project = sales_order.get("project")

        if existing_project:
            return (
                f"Sales Order '{sales_order_id}' is already linked to Project "
                f"'{existing_project}'. I did not create another Project."
            )

    resolved_project_name = (project_name or "").strip()
    if not resolved_project_name:
        if customer and sales_order_id:
            resolved_project_name = f"{customer} - {sales_order_id}"
        else:
            return (
                "A project name is required when creating a standalone Project. "
                "Please provide project_name."
            )

    # ---------------------------------------------------------------
    # 2. Resolve Project Users BEFORE writing
    # ---------------------------------------------------------------
    requested_project_users = list(project_users or [])

    # Every Task assignee also needs to be present in Project Users.
    requested_project_users.extend(
        task["assigned_to"] for task in normalized_tasks
    )

    resolved_users, user_error = _unique_users(
        [str(value) for value in requested_project_users]
    )

    if user_error:
        return (
            "Project was not created because a user could not be resolved: "
            f"{user_error}"
        )

    # ---------------------------------------------------------------
    # 3. Build Project data
    # ---------------------------------------------------------------
    project_data: Dict[str, Any] = {
        "project_name": resolved_project_name,
        **(extra_project_fields or {}),
    }

    # Values inferred from the Sales Order should win unless explicitly
    # overridden through extra_project_fields.
    if sales_order_id:
        project_data["customer"] = customer
        project_data["sales_order"] = sales_order_id

        if sales_company:
            project_data["company"] = sales_company

    if expected_start_date:
        project_data["expected_start_date"] = expected_start_date

    if expected_end_date:
        project_data["expected_end_date"] = expected_end_date

    if priority:
        project_data["priority"] = priority

    if project_type:
        project_data["project_type"] = project_type

    if department:
        project_data["department"] = department

    project_data = _fill_default_company("Project", project_data)

    project_issue = _check_required("Project", project_data)

    if project_issue:
        return (
            f"Project was not created. {project_issue}"
        )

    # This is exactly the Project form's Users child table.
    project_data["users"] = [
        {
            "user": user,
            "welcome_email_sent": 1,
        }
        for user in resolved_users
    ]

    # ---------------------------------------------------------------
    # 4. Create Project
    # ---------------------------------------------------------------
    project_result = _safe_call(
        f"create Project '{resolved_project_name}'",
        lambda: erp_client.create_doc(
            "Project",
            project_data,
        ),
    )

    if isinstance(project_result, str):
        return (
            f"Could not create Project '{resolved_project_name}': "
            f"{project_result}"
        )

    project_id = project_result.get("name")

    if not project_id:
        return (
            f"Project '{resolved_project_name}' was created, but ERPNext "
            "did not return its ID. Tasks were not created."
        )

    summary = [
        f"Project '{resolved_project_name}' created successfully "
        f"(ID: {project_id}).",
    ]

    if customer:
        summary.append(f"Customer: {customer}.")

    if sales_order_id:
        summary.append(f"Sales Order: {sales_order_id}.")

    if resolved_users:
        summary.append(
            "Project users: " + ", ".join(resolved_users) + "."
        )

    # ---------------------------------------------------------------
    # 5. Update Sales Order -> Project, only when relevant
    # ---------------------------------------------------------------
    if sales_order_id:
        try:
            erp_client.update_doc(
                "Sales Order",
                sales_order_id,
                {"project": project_id},
            )
            summary.append(
                f"Sales Order '{sales_order_id}' linked to Project '{project_id}'."
            )
        except Exception as exc:
            summary.append(
                "Warning: the Project was created, but the Sales Order's "
                f"Project field could not be updated: "
                f"{explain_erp_error(exc)}"
            )

    # ---------------------------------------------------------------
    # 6. Create EVERY Task
    # ---------------------------------------------------------------
    created_task_count = 0
    failed_task_count = 0

    for index, task in enumerate(normalized_tasks, start=1):
        subject = task["subject"]
        assigned_result = _resolve_user(task["assigned_to"])

        if "error" in assigned_result:
            failed_task_count += 1
            summary.append(
                f"- Task #{index} '{subject}' was not created: "
                f"{assigned_result['error']}"
            )
            continue

        user = assigned_result["user"]

        task_data: Dict[str, Any] = {
            "subject": subject,
            "project": project_id,
            "priority": task["priority"],
            "description": task["description"],
        }

        if task.get("due_date"):
            task_data["exp_end_date"] = task["due_date"]

        if task.get("expected_start_date"):
            task_data["exp_start_date"] = task["expected_start_date"]

        task_issue = _check_required("Task", task_data)

        if task_issue:
            failed_task_count += 1
            summary.append(
                f"- Task #{index} '{subject}' was not created: "
                f"{task_issue}"
            )
            continue

        # IMPORTANT: this call happens inside the loop, so ALL tasks are
        # independently created. There is no "first task only" logic.
        task_result = _safe_call(
            f"create Task #{index} '{subject}'",
            lambda task_data=task_data: erp_client.create_doc(
                "Task",
                task_data,
            ),
        )

        if isinstance(task_result, str):
            failed_task_count += 1

            # Make the common custom-unique-subject case explicit.
            lower_error = task_result.lower()

            if "unique" in lower_error and "subject" in lower_error:
                summary.append(
                    f"- Task #{index} '{subject}' was not created because "
                    "this ERPNext site appears to have a custom UNIQUE "
                    "constraint/validation on Task Subject. Standard "
                    "ERPNext v16 does not require Task Subject to be unique."
                )
            else:
                summary.append(
                    f"- Task #{index} '{subject}' was not created: "
                    f"{task_result}"
                )

            continue

        task_id = task_result.get("name")

        if not task_id:
            failed_task_count += 1
            summary.append(
                f"- Task #{index} '{subject}' was created, but ERPNext "
                "did not return its Task ID, so assignment was skipped."
            )
            continue

        created_task_count += 1

        assignment = _assign_task_without_email(
            task_id=task_id,
            user=user,
            description=task["description"],
            priority=task["priority"],
            due_date=task.get("due_date"),
        )

        if not assignment["ok"]:
            summary.append(
                f"- Task #{index} '{subject}' ({task_id}) created, "
                f"but assignment to {user} failed: "
                f"{assignment['error']}"
            )
            continue

        if assignment.get("already_assigned"):
            summary.append(
                f"- Task #{index} '{subject}' ({task_id}) already assigned "
                f"to {user}."
            )
        else:
            summary.append(
                f"- Task #{index} '{subject}' ({task_id}) created and "
                f"assigned to {user}."
            )

    # ---------------------------------------------------------------
    # 7. Final summary
    # ---------------------------------------------------------------
    summary.append(
        f"Tasks created: {created_task_count}/{len(normalized_tasks)}."
    )

    if failed_task_count:
        summary.append(
            f"Tasks not created: {failed_task_count}."
        )

    summary.append("No email was sent by this workflow.")

    return "\n".join(summary)


PROJECT_ONBOARDING_TOOLS = [create_project_for_sales_order]
