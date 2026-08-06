from unittest.mock import patch

from web.web_tool import WEB_TOOLS, web_fetch_page, web_search


def test_all_web_tools_are_registered():
    assert [tool.name for tool in WEB_TOOLS] == [
        "web_search",
        "web_fetch_page",
        "web_crawl",
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
