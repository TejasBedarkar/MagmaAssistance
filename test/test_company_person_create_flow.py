"""Regression tests for company-versus-person Lead creation safeguards."""

from unittest.mock import patch

from ERP_Unified import tools


LEAD_META = {
    "fields": [
        {"fieldname": "lead_name", "fieldtype": "Data"},
        {"fieldname": "company_name", "fieldtype": "Data"},
    ]
}


def test_unified_create_asks_for_contact_when_only_company_is_known():
    tools._PENDING_CREATES.clear()
    tools._PENDING_PARTY_TYPES.clear()
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META):
        classification = tools._run_create("Lead", {"company_name": "Infosys"}, False, "company-only")
        answer = tools._run_create(
            "Lead", {}, False, "company-only", party_type="company"
        )

    assert "person or a company" in classification
    assert "contact person's name" in answer
    assert "field: lead_name" in answer


def test_unified_create_rejects_company_as_lead_name_even_without_suffix():
    tools._PENDING_CREATES.clear()
    tools._PENDING_PARTY_TYPES.clear()
    tools._PENDING_PARTY_TYPES[("reused-brand", "Lead")] = "company"
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META):
        answer = tools._run_create(
            "Lead",
            {"company_name": "Infosys", "lead_name": "Infosys"},
            False,
            "reused-brand",
        )

    assert "not the lead/contact name" in answer


def test_unified_create_marks_only_a_real_erp_insert_as_created():
    tools._PENDING_CREATES.clear()
    tools._PENDING_PARTY_TYPES.clear()
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META), patch(
        "ERP_Unified.tools.erp_client.create_doc", return_value={"name": "LEAD-0001"}
    ):
        answer = tools._run_create(
            "Lead",
            {"lead_name": "Asha Rao"},
            False,
            "created-marker",
            party_type="person",
        )

    assert answer.startswith("CREATED: Lead 'LEAD-0001'.")


def test_unified_create_keeps_collected_values_after_an_erp_rejection():
    tools._PENDING_CREATES.clear()
    tools._PENDING_PARTY_TYPES.clear()
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META), patch(
        "ERP_Unified.tools.erp_client.create_doc", side_effect=RuntimeError("server rejected it")
    ):
        answer = tools._run_create(
            "Lead",
            {"lead_name": "Asha Rao"},
            False,
            "retry-after-error",
            party_type="person",
        )

    assert not answer.startswith("CREATED:")
    assert tools._PENDING_CREATES[("retry-after-error", "Lead")]["lead_name"] == "Asha Rao"
