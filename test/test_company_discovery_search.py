import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from web.company_resolver import (
    company_identity_stage,
    discover_companies,
    discovery_stage,
    resolve_company,
    search_once,
    targeted_search,
)


def test_google_is_primary_and_its_ranking_is_preserved():
    google_urls = [
        "https://first-example.com/about",
        "https://second-example.com",
        "https://third-example.com/contact",
    ]

    with patch("web.company_resolver._google_places_search", return_value=[]), patch(
        "web.company_resolver._google_search", return_value=google_urls
    ), patch.dict(sys.modules, {"ddgs": SimpleNamespace(DDGS=MagicMock())}):
        candidates = discover_companies("Example Company")

    assert [candidate.website for candidate in candidates] == google_urls
    assert [candidate.source for candidate in candidates] == ["google"] * 3
    assert [candidate.id for candidate in candidates] == [1, 2, 3]


def test_ddgs_is_used_only_when_google_fails():
    fallback_results = [
        {"title": "Fallback Co", "href": "https://fallback.example", "body": "Official site"}
    ]

    ddgs_instance = MagicMock()
    ddgs_instance.__enter__.return_value.text.return_value = fallback_results

    with patch("web.company_resolver._google_places_search", return_value=[]), patch(
        "web.company_resolver._google_search", side_effect=RuntimeError("blocked")
    ), patch.dict(sys.modules, {"ddgs": SimpleNamespace(DDGS=MagicMock(return_value=ddgs_instance))}):
        results = search_once("Fallback Co")

    assert results == [
        {
            "href": "https://fallback.example",
            "title": "Fallback Co",
            "body": "Official site",
            "source": "ddgs",
        }
    ]


def test_ddgs_is_used_when_google_has_no_eligible_website():
    fallback_results = [
        {"title": "Fallback Co", "href": "https://fallback.example", "body": "Official site"}
    ]

    ddgs_instance = MagicMock()
    ddgs_instance.__enter__.return_value.text.return_value = fallback_results

    with patch("web.company_resolver._google_places_search", return_value=[]), patch(
        "web.company_resolver._google_search",
        return_value=["https://www.linkedin.com/company/fallback-co"],
    ), patch.dict(
        sys.modules, {"ddgs": SimpleNamespace(DDGS=MagicMock(return_value=ddgs_instance))}
    ):
        results = search_once("Fallback Co")

    assert results[0]["source"] == "ddgs"
    ddgs_instance.__enter__.return_value.text.assert_called_once()


def test_discovery_always_requires_user_to_select_a_website():
    with patch(
        "web.company_resolver._google_search",
        return_value=["https://only-example.com"],
    ):
        result = discovery_stage("Only Example")

    assert result.status == "clarification_required"
    assert result.candidates[0]["website"] == "https://only-example.com"


def test_targeted_search_keeps_google_order_and_assigns_candidate_numbers():
    google_urls = [
        "https://first-example.com/about",
        "https://second-example.com",
        "https://third-example.com/contact",
    ]

    with patch("web.company_resolver._google_search", return_value=google_urls):
        candidates = targeted_search("Example Company", "India")

    assert [candidate.website for candidate in candidates] == google_urls
    assert [candidate.id for candidate in candidates] == [1, 2, 3]


def test_company_identity_stage_returns_mca_candidates_when_available():
    mca_candidates = [
        {"id": 1, "name": "ABC Private Limited", "cin": "U123", "source": "mca_data_gov_in"},
        {"id": 2, "name": "ABC Industries Limited", "cin": "U456", "source": "mca_data_gov_in"},
    ]

    with patch("web.company_resolver.discover_indian_companies", return_value=mca_candidates):
        result = company_identity_stage("ABC")

    assert result is not None
    assert result.status == "clarification_required"
    assert result.candidates == mca_candidates
    assert "Which legal entity do you mean?" in result.question


def test_resolve_company_selected_cin_leads_to_website_selection():
    legal_matches = [
        {"id": 1, "name": "ABC Private Limited", "cin": "U123", "source": "mca_data_gov_in"}
    ]
    website_choice = [
        {
            "id": 1,
            "name": "ABC Private Limited",
            "website": "https://abc.example",
            "source": "google_places",
        }
    ]

    with patch("web.company_resolver.discover_indian_companies", return_value=legal_matches), patch(
        "web.company_resolver.discovery_stage"
    ) as discovery_stage_mock:
        discovery_stage_mock.return_value = SimpleNamespace(
            status="clarification_required",
            query="ABC Private Limited",
            candidates=website_choice,
        )
        result = resolve_company("ABC", selected_company_cin="U123")

    discovery_stage_mock.assert_called_once_with("ABC Private Limited")
    assert result.status == "clarification_required"
    assert result.candidates == website_choice
