from unittest.mock import patch

from ERP_Unified.tools import _prepare_write_data


LEAD_META = {
    "fields": [
        {"fieldname": "company_name", "fieldtype": "Data"},
        {"fieldname": "company", "fieldtype": "Link", "options": "Company"},
        {"fieldname": "industry", "fieldtype": "Link", "options": "Industry"},
        {"fieldname": "status", "fieldtype": "Select", "options": "Lead\nOpen"},
        {"fieldname": "email_id", "fieldtype": "Data", "options": "Email"},
    ]
}


def test_external_employer_moves_to_company_name_when_not_an_internal_company():
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META), patch(
        "ERP_Unified.tools.erp_client.get_list", return_value=[]
    ):
        cleaned, warnings = _prepare_write_data("Lead", {"company": "Microsoft"})

    assert cleaned == {"company_name": "Microsoft"}
    assert "internal ERP Company" in warnings[0]


def test_existing_internal_company_is_kept():
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META), patch(
        "ERP_Unified.tools.erp_client.get_list", return_value=[{"name": "Magnadata PVT. LTD."}]
    ):
        cleaned, warnings = _prepare_write_data(
            "Lead", {"company": "Magnadata PVT. LTD.", "company_name": "Microsoft"}
        )

    assert cleaned["company"] == "Magnadata PVT. LTD."
    assert cleaned["company_name"] == "Microsoft"
    assert warnings == []


def test_invalid_optional_links_and_selects_are_omitted():
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META), patch(
        "ERP_Unified.tools.erp_client.get_list", return_value=[]
    ):
        cleaned, warnings = _prepare_write_data(
            "Lead", {"company_name": "Microsoft", "industry": "Imaginary", "status": "New"}
        )

    assert cleaned == {"company_name": "Microsoft"}
    assert len(warnings) == 2


def test_invalid_email_is_omitted_and_valid_email_is_trimmed():
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=LEAD_META):
        invalid, warnings = _prepare_write_data("Lead", {"email_id": "bill.gates@Microsoft"})
        valid, valid_warnings = _prepare_write_data(
            "Lead", {"email_id": " bill.gates@microsoft.com "}
        )

    assert "email_id" not in invalid
    assert "not a valid email" in warnings[0]
    assert valid["email_id"] == "bill.gates@microsoft.com"
    assert valid_warnings == []
