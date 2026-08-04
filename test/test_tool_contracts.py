"""Regression tests for ERP tool/orchestrator schema contracts.

Rewritten for the dynamic, doctype-agnostic tool set (ERP/tools/
dynamic_erp_tools.py) that replaced the old hand-written per-doctype
modules -- there's no per-doctype schema to check against a hand-
maintained REQUIRED_FIELDS list anymore (required fields are looked up
live from ERPNext's own metadata, see server.py's _dynamic_required_fields),
so these tests focus on: the generic tool set itself being well-formed,
and erp_client's custom_ui-vs-direct-REST routing behaving correctly
under a bound identity.
"""

from collections import Counter
from unittest.mock import MagicMock, patch

from ERP.tools import ALL_FIELD_PARSERS, ALL_REQUIRED_FIELDS, ALL_TOOLS
from ERP.tools.dynamic_erp_tools import (
    create_record, update_record, delete_record, get_records, get_record,
    count_records, get_doctype_fields,
)
from ERP.erp_client import ERPClient, ERPIdentity, use_identity


def test_local_tool_names_are_unique():
    counts = Counter(tool.name for tool in ALL_TOOLS)
    assert [name for name, count in counts.items() if count > 1] == []


def test_required_fields_exactly_match_tool_schemas():
    # ALL_REQUIRED_FIELDS is expected to be empty now -- create_record/
    # update_record's required fields are computed live per-doctype, not
    # declared statically. This test still guards against a future
    # module reintroducing a stale/mismatched static entry.
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


def test_dynamic_write_tools_present_with_expected_schema():
    names = {t.name for t in [create_record, update_record, delete_record]}
    assert names == {"create_record", "update_record", "delete_record"}
    assert set(create_record.args_schema.model_fields) == {"doctype", "data"}
    assert set(update_record.args_schema.model_fields) == {"doctype", "name", "data"}
    assert set(delete_record.args_schema.model_fields) == {"doctype", "name"}


def test_dynamic_read_tools_present():
    names = {t.name for t in [get_records, get_record, count_records, get_doctype_fields]}
    assert names == {"get_records", "get_record", "count_records", "get_doctype_fields"}


def test_get_list_routes_through_custom_ui_when_identity_bound():
    """With an ERPIdentity bound, get_list must call custom_ui's
    execute_doc_action (POST /api/method/custom_ui.api.crud.execute_doc_action)
    instead of the raw /api/resource/ REST endpoint -- this is the whole
    point of the custom_ui integration (real per-user role enforcement +
    3-strikes alerting instead of the shared service account)."""
    client = ERPClient()
    client.base_url = "http://localhost:8000"

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {"message": [{"name": "CUST-0001"}]}

    identity = ERPIdentity(api_key="k", api_secret="s", user="tester@example.com", roles=["Sales User"])
    with use_identity(identity):
        with patch("ERP.erp_client.requests.post", return_value=fake_response) as post:
            result = client.get_list("Customer", filters={"status": "Open"})

    assert result == [{"name": "CUST-0001"}]
    called_url = post.call_args.kwargs.get("url") or post.call_args.args[0]
    assert "custom_ui.api.crud.execute_doc_action" in called_url
    sent_json = post.call_args.kwargs["json"]
    assert sent_json["action"] == "get_list"
    assert sent_json["doctype"] == "Customer"


def test_get_list_uses_direct_rest_when_no_identity_bound():
    """With no identity bound, get_list must fall back to the shared
    service account via the raw REST endpoint -- unchanged legacy
    behavior for system/internal calls."""
    client = ERPClient()
    client.base_url = "http://localhost:8000"

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {"data": [{"name": "CUST-0001"}]}
    fake_response.raise_for_status = lambda: None

    with patch.object(client.session, "get", return_value=fake_response) as get:
        result = client.get_list("Customer")

    assert result == [{"name": "CUST-0001"}]
    called_url = get.call_args.args[0] if get.call_args.args else get.call_args.kwargs.get("url")
    assert "/api/resource/Customer" in called_url
