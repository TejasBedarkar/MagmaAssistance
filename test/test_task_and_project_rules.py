"""
test_task_and_project_rules.py
------------------------------
Task field aliases, blocking a Lead ID used as a Customer, and per-conversation defaults.
"""

from unittest.mock import patch

from ERP_Unified import tools, validation


TASK_META = {"fields": [
    {"fieldname": "subject", "fieldtype": "Data"},
    {"fieldname": "exp_end_date", "fieldtype": "Date"},
    {"fieldname": "exp_start_date", "fieldtype": "Date"},
    {"fieldname": "priority", "fieldtype": "Select", "options": "Low\nMedium\nHigh\nUrgent"},
]}
PROJECT_META = {"fields": [{"fieldname": "customer", "fieldtype": "Link", "options": "Customer"}]}


def test_task_due_date_maps_to_exp_end_date():
    with patch.object(validation.erp_client, "get_meta", return_value=TASK_META):
        data, _ = validation._prepare_write_data("Task", {"subject": "x", "due_date": "2026-10-20", "priority": "High"})
    assert data["exp_end_date"] == "2026-10-20" and "due_date" not in data


def test_lead_id_as_customer_is_blocked():
    with patch.object(validation.erp_client, "get_meta", return_value=PROJECT_META), \
         patch.object(validation, "_resolve_link_value", return_value=None), \
         patch.object(validation, "_find_pipeline_source", return_value="Lead"):
        msg = validation.find_blocking_link_problem("Project", {"customer": "CRM-LEAD-2026-00027"})
    assert msg and "Lead ID" in msg and "convert_crm_record" in msg


def test_real_customer_is_not_blocked():
    with patch.object(validation.erp_client, "get_meta", return_value=PROJECT_META), \
         patch.object(validation, "_resolve_link_value", return_value="Freshworks"):
        assert validation.find_blocking_link_problem("Project", {"customer": "Freshworks"}) is None


def test_session_defaults_company_and_project():
    tools._SESSION_COMPANY["s"] = "MagnaData Pvt. Ltd."
    tools._LAST_PROJECT["s"] = "PROJ-0011"
    with patch.object(tools, "_default_company", return_value=None):
        task = tools.apply_session_defaults("s", "Task", {"subject": "x"})
        explicit = tools.apply_session_defaults("s", "Task", {"subject": "x", "project": "PROJ-9", "company": "Other"})
        other_session = tools.apply_session_defaults("nobody", "Task", {"subject": "x"})
    assert task["company"] == "MagnaData Pvt. Ltd." and task["project"] == "PROJ-0011"
    assert explicit["project"] == "PROJ-9" and explicit["company"] == "Other"
    assert "project" not in other_session
