from unittest.mock import MagicMock

import requests

from ERP.dynamic_fields import explain_erp_error


def test_invalid_query_field_is_not_reported_as_rbac_denial():
    response = MagicMock()
    response.status_code = 417
    response.json.return_value = {
        "exception": "frappe.exceptions.DataError: Field not permitted in query: total_amount"
    }
    error = requests.HTTPError("417 Client Error", response=response)

    message = explain_erp_error(error, "list Sales Order")

    assert "field that does not exist or cannot be queried" in message
    assert "doesn't have permission" not in message
    assert "erp_describe_fields" in message
