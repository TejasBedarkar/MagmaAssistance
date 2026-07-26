"""
ERP/tools/hr_write_tools.py

Create/update tools for the HR module, on ERPNext's DEFAULT REST API
(POST/PUT /api/resource/<Doctype>) via erp_client.create_doc() /
update_doc() / submit_doc() — same approach as sales_write_tools.py, just
for a different set of doctypes.

Field mapping notes (stock ERPNext v16 fieldnames):

  Employee            employee_name, department, designation,
                      date_of_joining, company, employment_type, gender,
                      status ("Active"/"Inactive"/"Left")
  Leave Application   employee, leave_type, from_date, to_date,
                      description (reason), status ("Open"/"Approved"/
                      "Rejected") — submittable (docstatus 0 -> 1)
  Attendance          employee, attendance_date, status ("Present"/
                      "Absent"/"On Leave"/"Half Day"), company —
                      submittable (docstatus 0 -> 1)

Same conventions as sales_write_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — failures are caught and turned into a short string the
    LLM can relay honestly.
  - optional args are typed Optional[...] = None and resolved inside the
    function body so small local models passing explicit `null` don't
    trip Pydantic validation, and _payload() drops None values so an
    update only touches fields the caller actually specified.

Add this list to ERP/tools/__init__.py:
    from .hr_write_tools import HR_WRITE_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *LEAD_TOOLS, *HR_WRITE_TOOLS]
"""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason (network, auth, validation, etc.)."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _payload(**kwargs):
    """Drops keys whose value is None, so update_* tools only send the
    fields the caller actually specified instead of nulling out every
    field the user didn't mention."""
    return {k: v for k, v in kwargs.items() if v is not None}


# ---------------------------------------------------------------------
# Employee
# ---------------------------------------------------------------------

@tool
def create_employee(
    employee_name: str,
    department: Optional[str] = None,
    designation: Optional[str] = None,
    date_of_joining: Optional[str] = None,
    company: Optional[str] = None,
    employment_type: Optional[str] = None,
    gender: Optional[str] = None,
):
    """Create a new Employee. `employee_name` is required (e.g. 'Priya
    Nair'). `date_of_joining` should be YYYY-MM-DD, defaults to today if
    not given. `company` and `department` fall back to your ERPNext
    site's configured defaults if not given. Use for requests like 'add
    a new employee Priya Nair, Sales department, joining today'."""

    def run():
        import datetime

        data = _payload(
            employee_name=employee_name,
            department=department,
            designation=designation,
            date_of_joining=date_of_joining or datetime.date.today().isoformat(),
            company=company,
            employment_type=employment_type,
            gender=gender,
        )
        result = erp_client.create_doc("Employee", data)
        return str(result)

    return _safe_call(f"create employee '{employee_name}'", run)


@tool
def update_employee(
    employee_id: str,
    department: Optional[str] = None,
    designation: Optional[str] = None,
    status: Optional[str] = None,
    employment_type: Optional[str] = None,
):
    """Update an existing Employee identified by their ID (e.g.
    'HR-EMP-00042'). Only the fields provided are changed. Use for
    requests like 'move employee HR-EMP-00042 to the Marketing
    department' or 'mark that employee as Inactive'."""

    def run():
        data = _payload(
            department=department,
            designation=designation,
            status=status,
            employment_type=employment_type,
        )
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Employee", employee_id, data)
        return str(result)

    return _safe_call(f"update employee {employee_id}", run)


# ---------------------------------------------------------------------
# Leave Application
# ---------------------------------------------------------------------

@tool
def create_leave_application(
    employee: str,
    leave_type: str,
    from_date: str,
    to_date: str,
    reason: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Leave Application for an employee. `employee` is the
    Employee ID (e.g. 'HR-EMP-00042'). `leave_type` should match a leave
    type configured on your site (e.g. 'Casual Leave', 'Sick Leave').
    `from_date`/`to_date` should be YYYY-MM-DD. Set `submit` true to
    submit it immediately rather than leave it as a draft. Use for
    requests like 'apply casual leave for HR-EMP-00042 from 2026-08-01
    to 2026-08-03'."""

    def run():
        data = _payload(
            employee=employee,
            leave_type=leave_type,
            from_date=from_date,
            to_date=to_date,
            description=reason,
        )
        result = erp_client.create_doc("Leave Application", data)

        if submit:
            leave_id = result.get("name")
            try:
                result = erp_client.submit_doc("Leave Application", leave_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create leave application for {employee}", run)


@tool
def update_leave_application(
    leave_application_id: str,
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    """Update an existing DRAFT Leave Application identified by its ID
    (e.g. 'HR-LAP-2026-00001'). Only the fields provided are changed.
    Use for requests like 'approve leave application HR-LAP-2026-00001'
    (pass status='Approved') or 'reject that leave request' (status=
    'Rejected'). Only works while the application is still a draft
    (docstatus 0) — a submitted one needs cancellation, not a plain
    update."""

    def run():
        data = _payload(status=status, from_date=from_date, to_date=to_date)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Leave Application", leave_application_id, data)
        return str(result)

    return _safe_call(f"update leave application {leave_application_id}", run)


# ---------------------------------------------------------------------
# Attendance
# ---------------------------------------------------------------------

@tool
def create_attendance(
    employee: str,
    attendance_date: Optional[str] = None,
    status: Optional[str] = None,
    submit: bool = True,
):
    """Mark Attendance for an employee on a given date. `employee` is the
    Employee ID (e.g. 'HR-EMP-00042'). `attendance_date` should be
    YYYY-MM-DD, defaults to today if not given. `status` should be one
    of 'Present', 'Absent', 'On Leave', or 'Half Day' (defaults to
    'Present'). Attendance records are submitted (docstatus 0 -> 1) by
    default since ERPNext generally requires submission for them to
    count. Use for requests like 'mark HR-EMP-00042 present today' or
    'mark HR-EMP-00042 absent on 2026-07-20'."""

    def run():
        import datetime

        data = _payload(
            employee=employee,
            attendance_date=attendance_date or datetime.date.today().isoformat(),
            status=status or "Present",
        )
        result = erp_client.create_doc("Attendance", data)

        if submit:
            attendance_id = result.get("name")
            try:
                result = erp_client.submit_doc("Attendance", attendance_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"mark attendance for {employee}", run)


HR_WRITE_TOOLS = [
    create_employee,
    update_employee,
    create_leave_application,
    update_leave_application,
    create_attendance,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
REQUIRED_FIELDS = {
    "create_employee": [
        ("employee_name", "What's the employee's name?"),
    ],
    "update_employee": [
        ("employee_id", "Which employee should I update? (its ID)"),
    ],
    "create_leave_application": [
        ("employee", "Which employee is this leave for? (their Employee ID)"),
        ("leave_type", "What type of leave? (e.g. Casual Leave, Sick Leave)"),
        ("from_date", "What's the start date of the leave? (YYYY-MM-DD)"),
        ("to_date", "What's the end date of the leave? (YYYY-MM-DD)"),
    ],
    "update_leave_application": [
        ("leave_application_id", "Which leave application should I update? (e.g. HR-LAP-2026-00001)"),
    ],
    "create_attendance": [
        ("employee", "Which employee is this attendance for? (their Employee ID)"),
    ],
}

FIELD_PARSERS = {}
