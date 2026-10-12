"""A guessed email is resolved to the person's real login; real emails and names still work as before."""

from unittest.mock import patch

from ERP.tools import project_onboarding_helpers as h

USERS = [{"name": "sales.manager@magnadata.local", "full_name": "Arjun Mehta"},
         {"name": "shoaib@maganaerp.com", "full_name": "Mohammad Shoaib"}]
EMPLOYEES = [{"name": "HR-EMP-00012", "employee_name": "Preeti Mishra", "user_id": None}]


def _like(value, pattern):
    return pattern.strip("%").lower() in str(value or "").lower()


def _fake_get_list(doctype, fields=None, filters=None, limit=20, **_):
    field, op, value = filters[0]
    rows = USERS if doctype == "User" else EMPLOYEES
    if op == "=":
        return [r for r in rows if r.get(field) == value]
    return [r for r in rows if _like(r.get(field), value)]


def _resolve(identifier):
    with patch.object(h.erp_client, "get_list", side_effect=_fake_get_list), \
         patch.object(h.erp_client, "get_doc", side_effect=Exception("not an employee id")):
        return h._resolve_assignee(identifier)


def test_real_login_email_passes_through():
    assert _resolve("sales.manager@magnadata.local") == {"user": "sales.manager@magnadata.local"}


def test_guessed_email_resolves_to_the_real_login():
    assert _resolve("arjun.mehta@maganaerp.com") == {"user": "sales.manager@magnadata.local"}
    assert _resolve("mohammad.shoaib@maganaerp.com") == {"user": "shoaib@maganaerp.com"}


def test_plain_name_still_resolves():
    assert _resolve("Arjun Mehta") == {"user": "sales.manager@magnadata.local"}


def test_employee_without_login_gets_a_clear_reason():
    result = _resolve("preeti.mishra@maganaerp.com")
    assert result["error"] == "Preeti Mishra has no MagnaERP login, so the task can't be assigned to them."
