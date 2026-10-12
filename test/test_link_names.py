"""A required Link field (customer) is filled from the *_name value the model sent, or a "did you mean" hint is given."""

from unittest.mock import patch

from ERP_Unified import link_names

CUSTOMERS = [{"name": "Freshworks", "customer_name": "Freshworks"}, {"name": "Zerodha", "customer_name": "Zerodha"},
             {"name": "CUST-2026-00004", "customer_name": "Brir Pharma"}]
SO_REQUIRED = [{"fieldname": "customer", "fieldtype": "Link", "options": "Customer"},
               {"fieldname": "company", "fieldtype": "Link", "options": "Company"}]


def _fake_get_list(doctype, fields=None, filters=None, limit=20, **_):
    if filters:
        return [r for r in CUSTOMERS if r["name"] == filters[0][2]]
    return CUSTOMERS


def _run(data):
    with patch.object(link_names, "get_required_fields", return_value=SO_REQUIRED), \
         patch.object(link_names.erp_client, "get_list", side_effect=_fake_get_list), \
         patch.object(link_names.erp_client, "get_meta", return_value={"title_field": "customer_name"}):
        return link_names.fill_links_from_names("Sales Order", data)


def test_exact_id_fills_customer():
    data, hint = _run({"customer_name": "Freshworks", "company": "MagnaData Pvt. Ltd."})
    assert data["customer"] == "Freshworks" and hint == ""


def test_spoken_variant_resolves_to_the_one_match():
    data, hint = _run({"customer_name": "Fresh works"})
    assert data["customer"] == "Freshworks" and hint == ""


def test_title_match_uses_the_record_id():
    data, _ = _run({"customer_name": "brir pharma"})
    assert data["customer"] == "CUST-2026-00004"


def test_misheard_name_gives_did_you_mean():
    data, hint = _run({"customer_name": "Freshwork"})
    assert "customer" not in data
    assert "Did you mean: Freshworks?" in hint


def test_unknown_name_says_it_does_not_exist():
    data, hint = _run({"customer_name": "Facewash Industries"})
    assert "customer" not in data and "exists in MagnaERP yet" in hint


def test_existing_link_value_is_left_alone():
    data, hint = _run({"customer": "Zerodha", "customer_name": "Freshworks"})
    assert data["customer"] == "Zerodha" and hint == ""
