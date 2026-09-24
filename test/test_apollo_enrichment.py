"""
test/test_apollo_enrichment.py
------------------------------
Unit tests for Apollo.io lead enrichment and graceful fallback pipeline.

Covers:
1. ApolloClient person matching and organization enrichment.
2. Direct person contact resolution.
3. Person-to-company fallback when person is missing or lacks direct contact.
4. Apollo-to-crawler fallback when company does not exist in Apollo.
5. Markdown review table formatting and confirmation gate.
6. Research field parser extraction from Apollo review tables.
"""

import pytest
from unittest.mock import MagicMock, patch

from web.apollo_client import ApolloClient, _clean_domain
from web.apollo_tool import enrich_lead_pipeline, apollo_enrich_lead
from agent.agent import _fields_from_research


def test_clean_domain_helper():
    assert _clean_domain("https://www.zerodha.com/about") == "zerodha.com"
    assert _clean_domain("http://tatamotors.com") == "tatamotors.com"
    assert _clean_domain("WWW.INFOSYS.COM") == "infosys.com"
    assert _clean_domain("acme.org") == "acme.org"
    assert _clean_domain("") is None
    assert _clean_domain(None) is None


def test_apollo_client_person_match_success():
    client = ApolloClient(api_key="test_key_123")
    
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "person": {
            "name": "Nikhil Kamath",
            "title": "Co-founder",
            "email": "nikhil@zerodha.com",
            "sanitized_phone": "+91 80 4040 2020",
            "linkedin_url": "https://linkedin.com/in/nikhilkamath",
            "organization": {
                "name": "Zerodha Broking Ltd",
                "website_url": "https://zerodha.com",
                "street_address": "153/154 4th Cross",
                "city": "Bengaluru",
                "state": "Karnataka",
                "postal_code": "560078",
                "country": "India",
                "short_description": "India's largest retail stock broker.",
            }
        }
    }

    with patch("requests.post", return_value=mock_resp):
        res = client.match_person(name="Nikhil Kamath", organization_name="Zerodha", domain="zerodha.com")
        assert res is not None
        assert res["lead_name"] == "Nikhil Kamath"
        assert res["email_id"] == "nikhil@zerodha.com"
        assert res["mobile_no"] == "+91 80 4040 2020"
        assert res["designation"] == "Co-founder"
        assert res["company_name"] == "Zerodha Broking Ltd"
        assert res["city"] == "Bengaluru"
        assert res["pincode"] == "560078"
        assert res["has_direct_email"] is True
        assert res["has_direct_phone"] is True


def test_apollo_client_organization_enrich_success():
    client = ApolloClient(api_key="test_key_123")
    
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "organization": {
            "name": "Acme Industrial Corp",
            "website_url": "https://acmecorp.com",
            "phone": "+1 555-0199",
            "email": "contact@acmecorp.com",
            "street_address": "123 Manufacturing Way",
            "city": "Detroit",
            "state": "Michigan",
            "postal_code": "48201",
            "country": "United States",
            "short_description": "Pioneering industrial solutions.",
        }
    }

    with patch("requests.post", return_value=mock_resp):
        res = client.enrich_organization(domain="acmecorp.com", company_name="Acme Corp")
        assert res is not None
        assert res["company_name"] == "Acme Industrial Corp"
        assert res["phone"] == "+1 555-0199"
        assert res["email_id"] == "contact@acmecorp.com"
        assert res["city"] == "Detroit"
        assert res["state"] == "Michigan"
        assert res["country"] == "United States"


def test_apollo_client_error_handling():
    client = ApolloClient(api_key="test_key_123")
    
    # 401 Unauthorized
    resp_401 = MagicMock()
    resp_401.status_code = 401
    with patch("requests.post", return_value=resp_401):
        assert client.match_person("Test Person") is None
        assert client.enrich_organization("test.com") is None

    # 429 Rate limit
    resp_429 = MagicMock()
    resp_429.status_code = 429
    with patch("requests.post", return_value=resp_429):
        assert client.match_person("Test Person") is None
        assert client.enrich_organization("test.com") is None


def test_enrich_lead_pipeline_direct_person_match():
    """Scenario 1: Person given and found on Apollo with direct contact."""
    mock_client = MagicMock(spec=ApolloClient)
    mock_client.is_configured.return_value = True
    mock_client.match_person.return_value = {
        "lead_name": "Rohan Sharma",
        "designation": "VP Procurement",
        "email_id": "rohan.sharma@acme.com",
        "mobile_no": "+91 98765 43210",
        "company_name": "Acme Technologies",
        "website": "https://acme.com",
        "address_line1": "Tower A, Tech Park",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411014",
        "country": "India",
        "has_direct_email": True,
        "has_direct_phone": True,
    }

    result = enrich_lead_pipeline(
        company_name="Acme Technologies",
        person_name="Rohan Sharma",
        client=mock_client,
    )

    assert "Source: Apollo.io (Verified Direct Contact)" in result
    assert "| Contact Person   | Rohan Sharma" in result or "| Contact Person | Rohan Sharma |" in result
    assert "rohan.sharma@acme.com" in result
    assert "+91 98765 43210" in result
    assert "Pune" in result
    assert "--- ACTION REQUIRED ---" in result
    # Organization enrich should NOT be called since direct person was satisfied
    mock_client.enrich_organization.assert_not_called()


def test_enrich_lead_pipeline_person_fallback_to_company():
    """Scenario 2: Person given but not found on Apollo -> Falls back to Company contact."""
    mock_client = MagicMock(spec=ApolloClient)
    mock_client.is_configured.return_value = True
    # Person match returns None
    mock_client.match_person.return_value = None
    
    # Organization enrichment returns company data
    mock_client.enrich_organization.return_value = {
        "company_name": "Acme Technologies",
        "website": "https://acme.com",
        "phone": "+91 20 6600 0000",
        "email_id": "info@acme.com",
        "address_line1": "Tower A, Tech Park",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411014",
        "country": "India",
        "has_direct_email": False,
        "has_direct_phone": False,
    }

    result = enrich_lead_pipeline(
        company_name="Acme Technologies",
        person_name="Rohan Sharma",
        client=mock_client,
    )

    assert "Source: Apollo.io (Company Fallback)" in result
    assert "Specific contact details for 'Rohan Sharma' were not found in Apollo.io" in result
    assert "Using the company's verified corporate contact and address instead" in result
    assert "Rohan Sharma" in result
    assert "+91 20 6600 0000" in result
    assert "Pune" in result
    assert "--- ACTION REQUIRED ---" in result


def test_enrich_lead_pipeline_company_not_in_apollo_triggers_crawler():
    """Scenario 3: Company not found in Apollo -> Triggers Web Crawler fallback."""
    mock_client = MagicMock(spec=ApolloClient)
    mock_client.is_configured.return_value = True
    mock_client.match_person.return_value = None
    mock_client.enrich_organization.return_value = None

    mock_crawler = MagicMock(return_value="Candidate websites for 'Unknown Local Shop': 1. unknownshop.in")
    
    result = enrich_lead_pipeline(
        company_name="Unknown Local Shop",
        person_name="Suresh",
        client=mock_client,
        crawler_fn=mock_crawler,
        resolver_fn=lambda name, **kwargs: [],
    )

    assert "Company 'Unknown Local Shop' was not found in Apollo.io database" in result
    assert "Triggering Web Crawler & ZaubaCorp fallback" in result
    assert "Candidate websites for 'Unknown Local Shop'" in result
    mock_crawler.assert_called_once_with(
        company_name="Unknown Local Shop",
        person_name="Suresh",
        domain=None,
    )


def test_research_field_parser_extracts_apollo_table():
    """Verify that agent._fields_from_research correctly parses Apollo Markdown table rows."""
    apollo_markdown = """
--- EXTRACTION COMPLETE ---
Source: Apollo.io (Verified Direct Contact)

| Field | Value |
| :--- | :--- |
| Contact Person | Satya Nadella |
| Designation | CEO |
| Company Name | Microsoft |
| Email | satya@microsoft.com (Verified Direct) |
| Phone | +1 425-882-8080 (Direct Dial) |
| Address | One Microsoft Way |
| City | Redmond |
| State | Washington |
| Pincode | 980521 |
| Country | United States |
| Website | https://microsoft.com |

--- ACTION REQUIRED ---
"""
    fields = _fields_from_research(apollo_markdown)
    assert fields.get("email_id") == "satya@microsoft.com"
    assert fields.get("phone") == "+1 425-882-8080"
    assert fields.get("city") == "Redmond"
    assert fields.get("state") == "Washington"
    assert fields.get("country") == "United States"
    assert fields.get("website") == "https://microsoft.com"

