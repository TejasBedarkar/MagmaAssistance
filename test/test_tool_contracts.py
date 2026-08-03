"""Regression tests for ERP tool/orchestrator schema contracts."""

from collections import Counter
from unittest.mock import patch

from ERP.tools import ALL_FIELD_PARSERS, ALL_REQUIRED_FIELDS, ALL_TOOLS
from ERP.tools.sales_write_tools import create_quotation


def test_local_tool_names_are_unique():
    counts = Counter(tool.name for tool in ALL_TOOLS)
    assert [name for name, count in counts.items() if count > 1] == []


def test_required_fields_exactly_match_tool_schemas():
    tools = {tool.name: tool for tool in ALL_TOOLS}
    for tool_name, questions in ALL_REQUIRED_FIELDS.items():
        schema = tools[tool_name].args_schema.model_fields
        schema_required = {name for name, field in schema.items() if field.is_required()}
        metadata_required = {name for name, _question in questions}
        assert metadata_required == schema_required, tool_name


def test_field_parsers_reference_real_schema_fields():
    tools = {tool.name: tool for tool in ALL_TOOLS}
    for tool_name, field_name in ALL_FIELD_PARSERS:
        assert field_name in tools[tool_name].args_schema.model_fields


def test_create_quotation_builds_expected_erpnext_payload():
    with patch(
        "ERP.tools.sales_write_tools.erp_client.create_doc",
        return_value={"name": "QTN-TEST-00001"},
    ) as create_doc, patch(
        "ERP.tools.sales_write_tools._resolve_link",
        side_effect=lambda doctype, value: {
            ("Customer", "Updated via API"): "API-customer_name",
            ("Item", "API-item_code"): "API-item_code",
            ("Company", "Magnadata"): "Magnadata PVT. LTD.",
        }.get((doctype, value), value),
    ):
        result = create_quotation.invoke({
            "customer": "Updated via API",
            "date": "2026-08-03",
            "order_type": "Sales",
            "item_code": "API-item_code",
            "quantity": 5,
            "rate": 6,
            "company": "Magnadata",
        })

    assert "QTN-TEST-00001" in result
    create_doc.assert_called_once_with(
        "Quotation",
        {
            "quotation_to": "Customer",
            "party_name": "API-customer_name",
            "transaction_date": "2026-08-03",
            "items": [{"item_code": "API-item_code", "qty": 5, "rate": 6}],
            "order_type": "Sales",
            "company": "Magnadata PVT. LTD.",
        },
    )
