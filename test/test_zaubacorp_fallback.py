"""
test_zaubacorp_fallback.py
--------------------------
Unit and integration tests for the autonomous ZaubaCorp fallback mechanism:
1. Parsing ZaubaCorp HTML structure (Legal Name, CIN, Email, Registered Address, Directors).
2. Autonomous trigger when email is missing on official website.
3. Autonomous trigger when address is missing on official website.
4. Autonomous trigger when both email and address are missing.
5. Non-trigger when official site already provides both email and address.
6. Graceful behavior when ZaubaCorp returns no matching records (e.g. non-Indian company).
"""

import pytest
from unittest.mock import MagicMock, patch
from bs4 import BeautifulSoup

from web.company_crawler.zaubacorp import (
    parse_zaubacorp_page,
    search_zaubacorp,
    lookup_zaubacorp_fallback,
    ZaubaCorpData,
)
from web.web_tool import web_company_extract


def test_parse_zaubacorp_page_structure():
    """Verify extraction of legal name, CIN, email, address, and directors from ZaubaCorp HTML."""
    sample_html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>ACME INNOVATIONS PRIVATE LIMITED - Company Details | Zauba Corp</title>
    </head>
    <body>
        <h1>ACME INNOVATIONS PRIVATE LIMITED</h1>
        <div class="col-lg-12">
            <p><strong>CIN:</strong> U72200MH2020PTC123456</p>
            <p><strong>Company Status:</strong> Active</p>
        </div>
        <div class="contact-details">
            <h5>Email ID</h5>
            <p><a href="mailto:directors@acmeinnovations.in">directors@acmeinnovations.in</a></p>
            
            <h5>Address</h5>
            <p>Unit 402, 4th Floor, Godrej Coliseum, Sion East, Mumbai, Maharashtra, India - 400022</p>
        </div>
        <table id="accordionImage">
            <tr>
                <th>DIN/PAN</th>
                <th>Name</th>
                <th>Designation</th>
            </tr>
            <tr>
                <td>08765432</td>
                <td>ANIL KUMAR SHARMA</td>
                <td>Director</td>
            </tr>
            <tr>
                <td>08765433</td>
                <td>SUNITA ANIL SHARMA</td>
                <td>Managing Director</td>
            </tr>
        </table>
    </body>
    </html>
    """
    data = parse_zaubacorp_page(sample_html, url="https://www.zaubacorp.com/company/ACME-INNOVATIONS-PRIVATE-LIMITED/U72200MH2020PTC123456")
    
    assert data.legal_name == "ACME INNOVATIONS PRIVATE LIMITED"
    assert data.cin == "U72200MH2020PTC123456"
    assert data.email == "directors@acmeinnovations.in"
    assert "Godrej Coliseum" in data.address
    assert "Mumbai" in data.address
    assert "400022" in data.address
    assert data.parsed_address is not None
    assert data.parsed_address["city"] == "Mumbai"
    assert data.parsed_address["pincode"] == "400022"
    assert "ANIL KUMAR SHARMA" in data.directors
    assert "SUNITA ANIL SHARMA" in data.directors
    assert data.company_status == "Active"


def test_fallback_when_website_missing_both_email_and_address():
    """Verify that when official site has only phone/description, ZaubaCorp fills in email, address, and CIN."""
    website_html = """
    <html>
    <head><title>Acme Innovations - Home</title></head>
    <body>
        <h1>Welcome to Acme Innovations</h1>
        <p>Leading provider of cloud technology solutions.</p>
        <a href="tel:+912266658000">+91 22 6665 8000</a>
    </body>
    </html>
    """
    mock_zauba_data = ZaubaCorpData(
        legal_name="ACME INNOVATIONS PRIVATE LIMITED",
        cin="U72200MH2020PTC123456",
        email="mca.contact@acmeinnovations.in",
        address="Unit 402, Godrej Coliseum, Sion East, Mumbai 400022",
        parsed_address={"address_line1": "Unit 402, Godrej Coliseum", "city": "Mumbai", "pincode": "400022", "country": "India"},
        directors=["ANIL KUMAR SHARMA"],
        zauba_url="https://www.zaubacorp.com/company/ACME/U72200MH2020PTC123456",
    )

    with patch("web.web_tool.get_page_html") as mock_html, \
         patch("web.web_tool.find_contact_pages") as mock_find, \
         patch("web.web_tool.lookup_zaubacorp_fallback") as mock_zauba:

        mock_find.return_value = []
        mock_html.return_value = (website_html, "http")
        mock_zauba.return_value = mock_zauba_data

        result = web_company_extract.invoke({"url": "https://acmeinnovations.in", "company_name": "Acme Innovations"})

        # Verify ZaubaCorp lookup was called with company name
        assert mock_zauba.called
        assert "Acme Innovations" in mock_zauba.call_args[0][0]

        # Verify results contain official phone + ZaubaCorp email + ZaubaCorp address
        assert "+91 22 6665 8000" in result
        assert "mca.contact@acmeinnovations.in" in result
        assert "Godrej Coliseum" in result
        assert "Mumbai" in result
        assert "400022" in result
        assert "U72200MH2020PTC123456" in result
        assert "ANIL KUMAR SHARMA" in result
        assert "zaubacorp fallback" in result
        assert "Source: ZaubaCorp / MCA Record" in result


def test_fallback_when_website_missing_only_address():
    """Verify that when official site has email and phone, ZaubaCorp fills in only the missing address."""
    website_html = """
    <html>
    <head><title>Acme Innovations</title></head>
    <body>
        <h1>Acme Innovations</h1>
        <a href="mailto:info@acmeinnovations.in">info@acmeinnovations.in</a>
        <a href="tel:+912266658000">+91 22 6665 8000</a>
    </body>
    </html>
    """
    mock_zauba_data = ZaubaCorpData(
        legal_name="ACME INNOVATIONS PRIVATE LIMITED",
        cin="U72200MH2020PTC123456",
        email="mca.registered@acmeinnovations.in",
        address="Unit 402, Godrej Coliseum, Sion East, Mumbai 400022",
        parsed_address={"address_line1": "Unit 402, Godrej Coliseum", "city": "Mumbai", "pincode": "400022", "country": "India"},
        directors=["ANIL KUMAR SHARMA"],
    )

    with patch("web.web_tool.get_page_html") as mock_html, \
         patch("web.web_tool.find_contact_pages") as mock_find, \
         patch("web.web_tool.lookup_zaubacorp_fallback") as mock_zauba:

        mock_find.return_value = []
        mock_html.return_value = (website_html, "http")
        mock_zauba.return_value = mock_zauba_data

        result = web_company_extract.invoke({"url": "https://acmeinnovations.in"})

        # Official email should be kept (not overwritten by ZaubaCorp email)
        assert "info@acmeinnovations.in" in result
        # Address should be filled from ZaubaCorp
        assert "Godrej Coliseum" in result
        assert "Mumbai" in result


def test_no_fallback_when_website_has_both_email_and_address():
    """Verify that when official site already provides email and address, ZaubaCorp is NOT queried."""
    website_html = """
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Acme Innovations",
            "email": "contact@acmeinnovations.in",
            "telephone": "+91 22 6665 8000",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "123 Tech Park",
                "addressLocality": "Bengaluru",
                "postalCode": "560001",
                "addressCountry": "India"
            }
        }
        </script>
    </head>
    <body>
        <h1>Acme Innovations</h1>
    </body>
    </html>
    """
    with patch("web.web_tool.get_page_html") as mock_html, \
         patch("web.web_tool.find_contact_pages") as mock_find, \
         patch("web.web_tool.lookup_zaubacorp_fallback") as mock_zauba:

        mock_find.return_value = []
        mock_html.return_value = (website_html, "http")

        result = web_company_extract.invoke({"url": "https://acmeinnovations.in"})

        # ZaubaCorp should NOT be called
        assert not mock_zauba.called
        assert "contact@acmeinnovations.in" in result
        assert "123 Tech Park" in result
        assert "Bengaluru" in result
        assert "zaubacorp fallback" not in result


def test_graceful_fallback_failure():
    """Verify that when ZaubaCorp yields no match, the crawler completes normally with website data."""
    website_html = """
    <html>
    <head><title>Global Corp - Overseas</title></head>
    <body>
        <h1>Global Corp International</h1>
        <p>A global multinational company.</p>
        <a href="tel:+14155550199">+1 415 555 0199</a>
    </body>
    </html>
    """
    with patch("web.web_tool.get_page_html") as mock_html, \
         patch("web.web_tool.find_contact_pages") as mock_find, \
         patch("web.web_tool.lookup_zaubacorp_fallback") as mock_zauba:

        mock_find.return_value = []
        mock_html.return_value = (website_html, "http")
        mock_zauba.return_value = None  # No ZaubaCorp record found

        result = web_company_extract.invoke({"url": "https://globalcorp.com"})

        assert "415-555-0199" in result or "+1 415 555 0199" in result
        assert "Email: not found" in result
        assert "Address: not found" in result


def test_parse_zaubacorp_magna_data_accordion_layout():
    """Verify parsing the modern ZaubaCorp accordion layout from user screenshot (MAGNA DATA)."""
    magna_html = """
    <div class="accordion-item mb-3" id="contact-details">
        <h2 class="accordion-header" id="heading-contact-details">
            <button aria-controls="collapse-contact-details" aria-expanded="true" class="accordion-button" data-bs-target="#collapse-contact-details" data-bs-toggle="collapse" type="button">
                Contact Details of MAGNA DATA
            </button>
        </h2>
        <div aria-labelledby="heading-contact-details" class="accordion-collapse collapse show" id="collapse-contact-details">
            <div class="accordion-body">
                <div class="row">
                    <div class="col-md-6">
                        <ul class="m-0 p-0">
                            <li class="row align-items-center">
                                <span class="col-sm-6">Email ID</span>
                                <label class="col-sm-6"></label>
                            </li>
                            <li class="row align-items-center">
                                <span class="col-sm-6">Website</span>
                                <label class="col-sm-6">Not Available</label>
                            </li>
                            <li class="row align-items-center">
                                <span class="col-sm-6">Address</span>
                                <label class="col-sm-6">SAJJAN ASSOCIATES SHOP-7,STATION ROAD CHINCHWADGAO,Pune City,Pune,Maharashtra,411033-India</label>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </div>
    """
    data = parse_zaubacorp_page(magna_html, url="https://www.zaubacorp.com/company/MAGNA-DATA-PRIVATE-LIMITED/U62090PN2025PTC249367")

    assert data.address == "SAJJAN ASSOCIATES SHOP-7,STATION ROAD CHINCHWADGAO,Pune City,Pune,Maharashtra,411033-India"
    assert data.parsed_address is not None
    assert data.parsed_address["city"] == "Pune"
    assert data.parsed_address["state"] == "Maharashtra"
    assert data.parsed_address["pincode"] == "411033"
    assert data.parsed_address["country"] == "India"
    assert "SAJJAN ASSOCIATES SHOP-7, STATION ROAD CHINCHWADGAO" in data.parsed_address["address_line1"]

