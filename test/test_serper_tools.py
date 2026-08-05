import json
from unittest.mock import MagicMock, patch

from Web.serper_tools import research_lead_web


def _response(items):
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"organic": items}
    return response


def test_lead_research_runs_targeted_queries_and_deduplicates_sources(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")
    items = [
        {
            "title": "Kunal Pradhan - MagnaData",
            "link": "https://example.com/team/kunal",
            "snippet": "Kunal Pradhan works at MagnaData Pvt. Ltd.",
        }
    ]
    with patch("Web.serper_tools.requests.post", return_value=_response(items)) as post:
        raw = research_lead_web.invoke(
            {"person_name": "Kunal Pradhan", "company_name": "MagnaData Pvt. Ltd."}
        )

    result = json.loads(raw)
    assert post.call_count == 3
    assert len(result["evidence"]) == 1
    assert result["evidence"][0]["url"] == "https://example.com/team/kunal"
    assert all(call.kwargs["headers"]["X-API-KEY"] == "test-key" for call in post.call_args_list)


def test_lead_research_reports_missing_configuration(monkeypatch):
    monkeypatch.delenv("SERPER_API_KEY", raising=False)
    result = research_lead_web.invoke(
        {"person_name": "Kunal Pradhan", "company_name": "MagnaData Pvt. Ltd."}
    )
    assert "SERPER_API_KEY" in result


def test_lead_research_is_registered_with_agent_tools():
    from Web.serper_tools import WEB_TOOLS

    assert [tool.name for tool in WEB_TOOLS] == ["research_lead_web"]
