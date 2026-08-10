from unittest.mock import patch

from ERP_Unified.tools import _prepare_lead_company


def test_external_company_moves_from_internal_link_to_company_name():
    with patch("ERP_Unified.tools.erp_client.get_list", return_value=[]):
        cleaned, warnings = _prepare_lead_company({"company": "Tata Motors"})

    assert cleaned == {"company_name": "Tata Motors"}
    assert "not an existing internal ERP Company" in warnings[0]


def test_existing_internal_company_remains_in_link_field():
    with patch("ERP_Unified.tools.erp_client.get_list", return_value=[{"name": "Magnadata PVT. LTD."}]):
        cleaned, warnings = _prepare_lead_company({"company": "Magnadata PVT. LTD."})

    assert cleaned == {"company": "Magnadata PVT. LTD."}
    assert warnings == []
