from unittest.mock import patch
from ERP.dynamic_fields import apply_default_values, missing_required_fields


def test_sales_order_defaults_auto_populate():
    data = {
        "customer": "Magna Data",
        "items": [{"item_code": "HB-Pencil", "qty": 10000}],
    }

    mock_comps = [{"name": "Demo Company", "default_currency": "INR"}]
    mock_whs = [{"name": "Finished Goods - DC", "company": "Demo Company", "is_group": 0}]

    with patch("ERP.dynamic_fields.erp_client.get_list") as mock_list:
        def _mock_get_list(doctype, *args, **kwargs):
            if doctype == "Company":
                return mock_comps
            if doctype == "Warehouse":
                return mock_whs
            return []

        mock_list.side_effect = _mock_get_list
        enriched = apply_default_values("Sales Order", data)

        assert enriched["company"] == "Demo Company"
        assert enriched["currency"] == "INR"
        assert enriched["conversion_rate"] == 1.0
        assert enriched["selling_price_list"] == "Standard Selling"
        assert enriched["order_type"] == "Sales"
        assert "delivery_date" in enriched
        assert enriched["set_warehouse"] == "Finished Goods - DC"
        assert enriched["items"][0]["warehouse"] == "Finished Goods - DC"
        assert enriched["items"][0]["delivery_date"] == enriched["delivery_date"]
        assert enriched["items"][0]["conversion_factor"] == 1.0

        missing = missing_required_fields("Sales Order", enriched)
        assert len(missing) == 0
