from unittest.mock import patch

from web.web_tool import (
    WEB_TOOLS,
    _normalize_url,
    web_company_lookup,
    web_fetch_page,
    web_search,
)


def test_all_web_tools_are_registered():
    assert [tool.name for tool in WEB_TOOLS] == [
        "web_search",
        "web_fetch_page",
        "web_company_lookup",
    ]


def test_fetch_page_rejects_incomplete_url():
    result = web_fetch_page.invoke({"url": "example.com"})
    assert "full http:// or https:// URL" in result


def test_web_search_uses_ddgs():
    fake_results = [
        {"title": "Example", "href": "https://example.com", "body": "Result text"}
    ]
    with patch("ddgs.DDGS.text", return_value=fake_results):
        result = web_search.invoke({"query": "example query", "max_results": 3})
    assert "Example" in result
    assert "https://example.com" in result


def test_normalize_url_removes_fragments_and_tracking_params():
    assert _normalize_url("https://example.com/about?utm_source=ads#top") == "https://example.com/about"
    assert _normalize_url("https://example.com/about/") == "https://example.com/about/"
    assert _normalize_url("https://example.com") == "https://example.com/"


def test_company_lookup_returns_json_and_delegates_to_resolver():
    fake = {
        "status": "verified",
        "query": "Example Ltd",
        "confidence": 0.91,
        "company_name": "Example Ltd",
        "website": "https://example.com",
        "email": "sales@example.com",
        "phone": "+91 1234567890",
    }
    with patch("web.web_tool.resolve_company") as resolver:
        resolver.return_value.to_dict.return_value = fake
        result = web_company_lookup.invoke({"company_name": "Example Ltd"})
    assert '"status": "verified"' in result
    assert "sales@example.com" in result


def test_company_lookup_can_require_clarification():
    fake = {
        "status": "clarification_required",
        "query": "ABC",
        "confidence": 0.61,
        "question": "Which ABC should I use?",
        "candidates": [
            {"name": "ABC Pune", "website": "https://abc.example"},
            {"name": "ABC Mumbai", "website": "https://abc2.example"},
        ],
    }
    with patch("web.web_tool.resolve_company") as resolver:
        resolver.return_value.to_dict.return_value = fake
        result = web_company_lookup.invoke({"company_name": "ABC"})
    assert '"status": "clarification_required"' in result
    assert "ABC Pune" in result