"""
test_lead_automation_crawler.py
--------------------------------
Comprehensive automated tests for:
1. Targeted Discovery & subpath/footer link extraction
2. JSON-LD and Microdata structured data extraction
3. Data sanitization (junk email/phone filtering)
4. Address parsing into address_line1, city, pincode, country
5. Person vs. Corporate fallback detection
6. ERPNext Lead & linked Address DocType creation
7. User transparency notification formatting
"""

import pytest
from unittest.mock import MagicMock, patch
from bs4 import BeautifulSoup

from web.company_crawler.crawler import (
    find_contact_pages,
    _extract_footer_links,
    COMMON_TARGETED_SUBPATHS,
)
from web.company_crawler.extractor import (
    extract_contact_info,
    parse_address_fields,
    _is_low_value_email,
    _normalize_phone,
    filter_emails_to_domain,
    pick_primary_email,
    pick_primary_phone,
    pick_primary_address,
    ParsedAddress,
    ExtractionResult,
)
from web.web_tool import web_company_extract


def test_junk_email_filtering():
    """Verify that image asset filenames and tracking/SaaS domains are rejected."""
    assert _is_low_value_email("logo@2x.png") is True
    assert _is_low_value_email("icon@2x.svg") is True
    assert _is_low_value_email("banner@3x.webp") is True
    assert _is_low_value_email("errors@sentry.io") is True
    assert _is_low_value_email("test@wixpress.com") is True
    assert _is_low_value_email("noreply@company.com") is True
    assert _is_low_value_email("user@example.com") is True
    
    # Valid company emails
    assert _is_low_value_email("info@tatamotors.com") is False
    assert _is_low_value_email("contact@acmecorp.in") is False
    assert _is_low_value_email("sundar.pichai@google.com") is False


def test_phone_number_formatting():
    """Verify that international phone numbers are validated and formatted cleanly."""
    formatted_in = _normalize_phone("022 6665 8282", default_region="IN")
    assert "+91" in formatted_in or "022" in formatted_in

    toll_free = _normalize_phone("1800 209 7979", default_region="IN")
    assert "1800" in toll_free


def test_structured_json_ld_extraction():
    """Verify structured address and contact extraction from schema.org JSON-LD."""
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Tata Motors Limited",
            "email": "contact@tatamotors.com",
            "telephone": "+91-22-66658282",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "Bombay House, 24 Homi Mody Street",
                "addressLocality": "Mumbai",
                "addressRegion": "Maharashtra",
                "postalCode": "400001",
                "addressCountry": "India"
            }
        }
        </script>
    </head>
    <body>
        <h1>Welcome to Tata Motors</h1>
    </body>
    </html>
    """
    res = extract_contact_info(html)
    assert "contact@tatamotors.com" in res.emails
    assert any("+91" in p for p in res.phones)
    assert len(res.addresses) > 0
    assert "Bombay House" in res.addresses[0]
    assert res.parsed_address is not None
    assert res.parsed_address["city"] == "Mumbai"
    assert res.parsed_address["pincode"] == "400001"
    assert res.parsed_address["country"] == "India"


def test_microdata_address_extraction():
    """Verify extraction from HTML5 Microdata."""
    html = """
    <div itemscope itemtype="http://schema.org/Organization">
        <span itemprop="name">Acme Industries</span>
        <div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
            <span itemprop="streetAddress">Plot 45, MIDC Industrial Area</span>,
            <span itemprop="addressLocality">Pune</span>,
            <span itemprop="postalCode">411018</span>,
            <span itemprop="addressCountry">India</span>
        </div>
        <span itemprop="telephone">+91 20 1234 5678</span>
        <span itemprop="email">info@acmeindustries.com</span>
    </div>
    """
    res = extract_contact_info(html)
    assert "info@acmeindustries.com" in res.emails
    assert res.parsed_address is not None
    assert "Plot 45" in res.parsed_address["address_line1"]
    assert res.parsed_address["city"] == "Pune"
    assert res.parsed_address["pincode"] == "411018"


def test_address_parsing_from_unstructured_text():
    """Verify parsing unstructured address lines into distinct fields."""
    raw = "Bombay House, 24 Homi Mody Street, Fort, Mumbai 400001, India"
    parsed = parse_address_fields(raw)
    assert parsed.city == "Mumbai"
    assert parsed.pincode == "400001"
    assert parsed.country == "India"
    assert "Bombay House" in parsed.address_line1


def test_targeted_discovery_footer_links():
    """Verify that footer contact links are extracted and prioritized."""
    html = """
    <html>
    <body>
        <main>
            <a href="/products">Products</a>
        </main>
        <footer>
            <div class="footer-links">
                <a href="/contact-us">Contact Us</a>
                <a href="/our-locations">Our Locations</a>
                <a href="/about-us">About Us</a>
            </div>
        </footer>
    </body>
    </html>
    """
    soup = BeautifulSoup(html, "lxml")
    from urllib.parse import urlparse
    parsed_home = urlparse("https://example.com")
    footer_scored = _extract_footer_links(soup, "https://example.com", parsed_home)
    
    assert any("contact-us" in url for url in footer_scored)
    assert any("our-locations" in url for url in footer_scored)


def test_person_vs_corporate_fallback_when_person_not_found():
    """Verify fallback detection when person's direct details are not found."""
    html = """
    <html>
    <body>
        <h1>Apex Technologies</h1>
        <p>Corporate Office: Cyber City, Tower B, Gurugram 122002, India</p>
        <a href="mailto:info@apextech.com">info@apextech.com</a>
        <a href="tel:+911241234567">+91 124 1234567</a>
    </body>
    </html>
    """
    res = extract_contact_info(html, target_person="Rajesh Sharma")
    assert res.direct_person_found is False
    assert res.is_fallback is True
    assert "email" in res.fallback_fields
    assert "phone" in res.fallback_fields
    assert "address" in res.fallback_fields


def test_person_vs_corporate_when_person_found():
    """Verify fallback is False when personal email is discovered."""
    html = """
    <html>
    <body>
        <h1>Apex Technologies</h1>
        <p>Leadership Team</p>
        <p>Rajesh Sharma - Managing Director</p>
        <a href="mailto:rajesh.sharma@apextech.com">rajesh.sharma@apextech.com</a>
        <a href="tel:+919876543210">+91 98765 43210</a>
    </body>
    </html>
    """
    res = extract_contact_info(html, target_person="Rajesh Sharma")
    assert res.direct_person_found is True
    assert res.is_fallback is False
    assert len(res.fallback_fields) == 0


def test_erpnext_lead_with_linked_address_creation():
    """Verify that creating a Lead with address info creates a linked Address DocType."""
    import asyncio
    from ERP_Unified.tools import erp_data_tool
    
    mock_lead_result = {"name": "CRM-LEAD-2026-00001", "lead_name": "Rajesh Sharma", "company_name": "Apex Tech"}
    mock_addr_result = {"name": "ADDR-00001", "address_title": "Apex Tech"}

    with patch("ERP_Unified.tools.erp_client.create_doc") as mock_create, \
         patch("ERP_Unified.tools.erp_client.get_meta") as mock_meta:
        
        mock_meta.return_value = {
            "fields": [
                {"fieldname": "lead_name", "fieldtype": "Data", "reqd": 1},
                {"fieldname": "company_name", "fieldtype": "Data"},
                {"fieldname": "email_id", "fieldtype": "Data"},
                {"fieldname": "mobile_no", "fieldtype": "Data"},
            ]
        }
        
        mock_create.side_effect = [mock_lead_result, mock_addr_result]

        lead_data = {
            "lead_name": "Rajesh Sharma",
            "company_name": "Apex Tech",
            "email_id": "info@apextech.com",
            "mobile_no": "+91 124 1234567",
            "address_line1": "Cyber City, Tower B",
            "city": "Gurugram",
            "pincode": "122002",
            "country": "India",
        }

        res = asyncio.run(erp_data_tool.ainvoke({
            "operation": "create",
            "doctype": "Lead",
            "data": lead_data,
            "session_id": "test_session",
            "approved": True,
        }))

        assert "CRM-LEAD-2026-00001" in str(res)
        assert mock_create.call_count >= 2
        # Check that Address creation was called with link to Lead
        second_call_args = mock_create.call_args_list[1]
        assert second_call_args[0][0] == "Address"
        assert second_call_args[0][1]["links"][0]["link_doctype"] == "Lead"
        assert second_call_args[0][1]["links"][0]["link_name"] == "CRM-LEAD-2026-00001"


def test_web_company_extract_with_fallback():
    """Verify that web_company_extract outputs structured address and fallback fields."""
    html = """
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Tata Motors",
            "email": "corporate@tatamotors.com",
            "telephone": "+91 22 6665 8282",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "Bombay House, 24 Homi Mody Street",
                "addressLocality": "Mumbai",
                "postalCode": "400001",
                "addressCountry": "India"
            }
        }
        </script>
    </head>
    <body>
        <h1>Tata Motors Official Site</h1>
        <footer>
            <a href="/contact-us">Contact Us</a>
        </footer>
    </body>
    </html>
    """
    with patch("web.web_tool.get_page_html") as mock_html, \
         patch("web.web_tool.find_contact_pages") as mock_find:
        mock_find.return_value = [{"url": "https://tatamotors.com/contact-us", "score": 15}]
        mock_html.return_value = (html, "http")

        res = web_company_extract.invoke({"url": "https://tatamotors.com", "person_name": "John Doe"})
        assert "corporate@tatamotors.com" in res
        assert "Bombay House" in res
        assert "Mumbai" in res
        assert "400001" in res
        assert "Is Fallback: Yes" in res
        assert "Fallback Fields:" in res


def test_transparency_notification_in_execute_pending():
    """Verify user transparency notice format when fallback data is used for Lead creation."""
    import asyncio
    import server
    from server import execute_pending_node

    state = {
        "pending_tool": "erp_data_tool",
        "task_slots": {
            "operation": "create",
            "doctype": "Lead",
            "is_fallback": True,
            "data": {
                "lead_name": "Ratan Tata",
                "company_name": "Tata Sons",
                "email_id": "info@tatasons.com",
                "mobile_no": "+91 22 6665 8282",
                "address": "Bombay House, 24 Homi Mody Street, Mumbai 400001",
            }
        },
        "session_id": "test_session_transparency",
        "user_id": "balaji",
        "messages": [],
    }

    async def _mock_tool(tool_name, args, session_id=None, user_id=None, prompt_text=None):
        return "{'name': 'CRM-LEAD-2026-00002'}"

    with patch.object(server, "_execute_tool", side_effect=_mock_tool):
        res = asyncio.run(execute_pending_node(state))
        
        msg_content = res["messages"][0].content
        assert "Created Lead for **Ratan Tata** from **Tata Sons** in ERPNext." in msg_content
        assert "*Note: I couldn't find the lead person's information (Ratan Tata) on the website, so using company's contact information (info@tatasons.com / +91 22 6665 8282 / Bombay House, 24 Homi Mody Street, Mumbai 400001).*" in msg_content


def test_condition_1_exact_person_email_tokens():
    """Verify that when a contact person name is given, person-specific email is extracted and preferred over generic info@ email."""
    html = """
    <html>
    <body>
        <h1>Magna Data Company</h1>
        <p>Contact Us:</p>
        <a href="mailto:info@magnadata.com">General Inquiry</a>
        <a href="mailto:rajat.sharma@magnadata.com">Rajat Sharma (Direct)</a>
        <a href="tel:+912212345678">+91 22 1234 5678</a>
    </body>
    </html>
    """
    res = extract_contact_info(html, target_person="Rajat Sharma", company_domain="magnadata.com")
    assert res.direct_person_found is True
    assert res.person_email == "rajat.sharma@magnadata.com"
    assert res.is_fallback is False
    assert len(res.fallback_fields) == 0
    assert res.fallback_notice is None
    assert res.company_email == "info@magnadata.com"


def test_condition_1_person_schema_org_json_ld():
    """Verify person-specific email and phone extraction from schema.org JSON-LD Person object."""
    html = """
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "Organization",
                    "name": "Magna Data Company",
                    "email": "info@magnadata.com",
                    "telephone": "+91 22 1111 2222"
                },
                {
                    "@type": "Person",
                    "name": "Rajat Sharma",
                    "email": "rajat.s@magnadata.com",
                    "telephone": "+91 98765 43210"
                }
            ]
        }
        </script>
    </head>
    <body>
        <h1>Magna Data</h1>
    </body>
    </html>
    """
    res = extract_contact_info(html, target_person="Rajat Sharma")
    assert res.direct_person_found is True
    assert res.person_email == "rajat.s@magnadata.com"
    assert any("98765" in p for p in [res.person_phone or ""])
    assert res.is_fallback is False


def test_condition_1_html_context_dom_proximity():
    """Verify that email and phone inside the same DOM block as the person name are matched."""
    html = """
    <html>
    <body>
        <div class="team-card">
            <h3>Rajat Sharma</h3>
            <p>Lead Engineer</p>
            <a href="mailto:rsharma@magnadata.com">Email Rajat</a>
            <a href="tel:+919876543210">+91 98765 43210</a>
        </div>
        <div class="footer">
            <a href="mailto:info@magnadata.com">info@magnadata.com</a>
        </div>
    </body>
    </html>
    """
    res = extract_contact_info(html, target_person="Rajat Sharma")
    assert res.direct_person_found is True
    assert res.person_email == "rsharma@magnadata.com"
    assert res.person_phone is not None
    assert "98765" in res.person_phone
    assert res.is_fallback is False


def test_condition_1_person_not_found_fallback_notification():
    """Verify fallback and transparent user notification when contact details for intended person are not found."""
    html = """
    <html>
    <body>
        <h1>Magna Data Company</h1>
        <p>Corporate Office: Bandra Kurla Complex, Mumbai 400051, India</p>
        <a href="mailto:contact@magnadata.com">contact@magnadata.com</a>
        <a href="tel:+912212345678">+91 22 1234 5678</a>
    </body>
    </html>
    """
    res = extract_contact_info(html, target_person="Rajat Sharma", company_domain="magnadata.com")
    assert res.direct_person_found is False
    assert res.is_fallback is True
    assert "email" in res.fallback_fields
    assert "phone" in res.fallback_fields
    assert res.company_email == "contact@magnadata.com"
    assert "Note: I couldn't find the lead person's information (Rajat Sharma)" in (res.fallback_notice or "")


def test_condition_2_company_only_lead():
    """Verify Condition 2: when no person name is given, directly extract company info without fallback flag or warning."""
    html = """
    <html>
    <body>
        <h1>Magna Data Company</h1>
        <p>Corporate Office: Bandra Kurla Complex, Mumbai 400051, India</p>
        <a href="mailto:info@magnadata.com">info@magnadata.com</a>
        <a href="tel:+912212345678">+91 22 1234 5678</a>
    </body>
    </html>
    """
    res = extract_contact_info(html, target_person=None, company_domain="magnadata.com")
    assert res.direct_person_found is False
    assert res.is_fallback is False
    assert len(res.fallback_fields) == 0
    assert res.fallback_notice is None
    assert res.company_email == "info@magnadata.com"


def test_multiple_persons_on_company_website_exact_matching():
    """Verify that when a website lists multiple people, only the requested lead person's details are selected, or corporate fallback is used if absent."""
    html = """
    <html>
    <body>
        <h1>Magna Data Company - Team</h1>
        <div class="team-grid">
            <div class="member">
                <h4>Vikram Malhotra</h4>
                <p>Chief Executive Officer</p>
                <a href="mailto:vikram.malhotra@magnadata.com">vikram.malhotra@magnadata.com</a>
                <a href="tel:+919876500001">+91 98765 00001</a>
            </div>
            <div class="member">
                <h4>Priya Singh</h4>
                <p>VP of Sales</p>
                <a href="mailto:priya.singh@magnadata.com">priya.singh@magnadata.com</a>
                <a href="tel:+919876500002">+91 98765 00002</a>
            </div>
            <div class="member">
                <h4>Rajat Sharma</h4>
                <p>Director of Engineering</p>
                <a href="mailto:rajat.sharma@magnadata.com">rajat.sharma@magnadata.com</a>
                <a href="tel:+919876543210">+91 98765 43210</a>
            </div>
        </div>
        <footer>
            <a href="mailto:info@magnadata.com">General: info@magnadata.com</a>
            <a href="tel:+912212345678">Switchboard: +91 22 1234 5678</a>
        </footer>
    </body>
    </html>
    """
    # 1. Matching person "Rajat Sharma"
    res_rajat = extract_contact_info(html, target_person="Rajat Sharma", company_domain="magnadata.com")
    assert res_rajat.direct_person_found is True
    assert res_rajat.person_email == "rajat.sharma@magnadata.com"
    assert res_rajat.person_phone is not None and "98765" in res_rajat.person_phone
    assert res_rajat.is_fallback is False

    # 2. Matching person "Priya Singh"
    res_priya = extract_contact_info(html, target_person="Priya Singh", company_domain="magnadata.com")
    assert res_priya.direct_person_found is True
    assert res_priya.person_email == "priya.singh@magnadata.com"
    assert res_priya.is_fallback is False

    # 3. Non-existent person "Suresh Kumar" -> Falls back to company info, does NOT pick Vikram/Priya/Rajat
    res_suresh = extract_contact_info(html, target_person="Suresh Kumar", company_domain="magnadata.com")
    assert res_suresh.direct_person_found is False
    assert res_suresh.is_fallback is True
    assert res_suresh.company_email == "info@magnadata.com"
    assert "Note: I couldn't find the lead person's information (Suresh Kumar)" in (res_suresh.fallback_notice or "")


def test_web_company_extract_condition_1_vs_condition_2():
    """Verify web_company_extract output differences between Condition 1 (person given) and Condition 2 (company only)."""
    html = """
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Magna Data Company",
            "email": "info@magnadata.com",
            "telephone": "+91 22 1234 5678",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "Tower A, BKC",
                "addressLocality": "Mumbai",
                "postalCode": "400051",
                "addressCountry": "India"
            }
        }
        </script>
    </head>
    <body>
        <h1>Magna Data</h1>
        <a href="mailto:rajat.sharma@magnadata.com">Rajat Sharma</a>
    </body>
    </html>
    """
    with patch("web.web_tool.get_page_html") as mock_html, \
         patch("web.web_tool.find_contact_pages") as mock_find:
        mock_find.return_value = []
        mock_html.return_value = (html, "http")

        # Condition 1 - Person Found
        res1 = web_company_extract.invoke({"url": "https://magnadata.com", "person_name": "Rajat Sharma"})
        assert "rajat.sharma@magnadata.com" in res1
        assert "Person Name: Rajat Sharma" in res1
        assert "Direct Person Found: Yes" in res1
        assert "Is Fallback: No" in res1

        # Condition 1 - Person Not Found
        res1_fallback = web_company_extract.invoke({"url": "https://magnadata.com", "person_name": "Amit Patel"})
        assert "info@magnadata.com" in res1_fallback
        assert "Person Name: Amit Patel" in res1_fallback
        assert "Direct Person Found: No" in res1_fallback
        assert "Is Fallback: Yes" in res1_fallback
        assert "Fallback Notice:" in res1_fallback
        assert "Amit Patel" in res1_fallback

        # Condition 2 - Company Only
        res2 = web_company_extract.invoke({"url": "https://magnadata.com", "person_name": None})
        assert "info@magnadata.com" in res2
        assert "Person Name" not in res2
        assert "Is Fallback" not in res2
        assert "Fallback Notice" not in res2


def test_intake_node_propagates_person_name():
    """Verify that intake_node passes person_name to web_company_extract when user selects a website."""
    import asyncio
    import server
    from server import intake_node
    from langchain_core.messages import HumanMessage
    from unittest.mock import AsyncMock, MagicMock

    state = {
        "messages": [HumanMessage(content="1")],
        "pending_tool": "await_website_confirmation",
        "pending_missing": [("selected_url", "Please pick 1 or 2")],
        "task_slots": {"_candidate_urls": ["https://magnadata.com", "https://other.com"]},
        "extracted_entities": {"person": "Rajat Sharma", "company_name": "Magna Data Company"},
        "session_id": "test_sess_intake",
        "user_id": "balaji",
    }

    mock_extract_tool = MagicMock()
    mock_extract_tool.name = "web_company_extract"
    mock_extract_tool.ainvoke = AsyncMock(return_value="Extracted details from https://magnadata.com\n- Email: rajat.sharma@magnadata.com")

    with patch("server.WEB_TOOLS", [mock_extract_tool]):
        res = asyncio.run(intake_node(state))
        
        assert mock_extract_tool.ainvoke.called
        call_args = mock_extract_tool.ainvoke.call_args[0][0]
        assert call_args["url"] == "https://magnadata.com"
        assert call_args["person_name"] == "Rajat Sharma"
        assert res["intake_route_override"] == "erp_context_node"


def test_proposal_node_condition_1_vs_condition_2():
    """Verify proposal formatting for Condition 1 fallback vs Condition 2 company lead."""
    from unittest.mock import MagicMock
    import server
    from server import proposal_node

    mock_assistant = MagicMock()
    mock_assistant.llm.model.invoke.return_value = MagicMock(content="Proposed Lead")

    # Condition 1: Person requested, fallback occurred
    state1 = {
        "extracted_entities": {"person": "Rajat Sharma", "company_name": "Magna Data", "record_type": "Lead"},
        "research_context": (
            "Extracted details from https://magnadata.com:\n"
            "- Email: info@magnadata.com\n"
            "- Phone: +91 22 1234 5678\n"
            "- Address: BKC, Mumbai 400051\n"
            "- Is Fallback: Yes\n"
            "- Fallback Notice: Note: I couldn't find the lead person's information (Rajat Sharma) on https://magnadata.com, so using company's contact information."
        ),
        "erp_context": "No existing lead.",
        "messages": [],
    }
    with patch("server.assistant", mock_assistant):
        res1 = proposal_node(state1)
        prop_msg = res1["messages"][0].content
        assert "- **Lead / Contact Person**: Rajat Sharma" in prop_msg
        assert "- **Company Name**: Magna Data" in prop_msg
        assert "*Note: I couldn't find the lead person's information (Rajat Sharma) on the website, so using company's contact information (like email and number).*" in prop_msg
        assert res1["task_slots"]["is_fallback"] is True

    # Condition 2: Company only requested
    state2 = {
        "extracted_entities": {"company_name": "Magna Data", "record_type": "Lead"},
        "research_context": (
            "Extracted details from https://magnadata.com:\n"
            "- Email: info@magnadata.com\n"
            "- Phone: +91 22 1234 5678\n"
            "- Address: BKC, Mumbai 400051"
        ),
        "erp_context": "No existing lead.",
        "messages": [],
    }
    with patch("server.assistant", mock_assistant):
        res2 = proposal_node(state2)
        prop_msg2 = res2["messages"][0].content
        assert "- **Company Name**: Magna Data" in prop_msg2
        assert "*Note:" not in prop_msg2
        assert res2["task_slots"]["is_fallback"] is False


def test_lead_city_preserves_full_street_address():
    """Verify that when creating a Lead, street/premise address is preserved in Lead.city instead of dropped."""
    import asyncio
    from ERP_Unified.tools import erp_data_tool

    with patch("ERP_Unified.tools.erp_client.get_meta") as mock_meta, \
         patch("ERP_Unified.tools.erp_client.create_doc") as mock_create, \
         patch("ERP_Unified.tools.erp_client.get_list") as mock_list:

        mock_meta.return_value = {
            "fields": [
                {"fieldname": "lead_name", "reqd": 1, "fieldtype": "Data"},
                {"fieldname": "company_name", "reqd": 0, "fieldtype": "Data"},
                {"fieldname": "email_id", "reqd": 0, "fieldtype": "Data"},
                {"fieldname": "mobile_no", "reqd": 0, "fieldtype": "Data"},
                {"fieldname": "city", "reqd": 0, "fieldtype": "Data"},
                {"fieldname": "state", "reqd": 0, "fieldtype": "Data"},
                {"fieldname": "country", "reqd": 0, "fieldtype": "Data"},
            ]
        }
        mock_list.return_value = []
        mock_create.side_effect = [
            {"name": "CRM-LEAD-2026-00002"},
            {"name": "ADDR-2026-00002"},
        ]

        lead_data = {
            "lead_name": "Roshan Babu",
            "company_name": "Magna Data",
            "email_id": "contact@magnadata.in",
            "mobile_no": "+91 77589 37300",
            "address_line1": "SAJJAN ASSOCIATES SHOP-7, STATION ROAD CHINCHWADGAO",
            "city": "Pune",
            "state": "Maharashtra",
            "country": "India",
            "pincode": "411033",
        }

        res = asyncio.run(erp_data_tool.ainvoke({
            "operation": "create",
            "doctype": "Lead",
            "data": lead_data,
            "session_id": "test_magna_session",
            "approved": True,
        }))

        assert "CRM-LEAD-2026-00002" in str(res)
        first_call_args = mock_create.call_args_list[0]
        assert first_call_args[0][0] == "Lead"
        lead_created_doc = first_call_args[0][1]
        assert lead_created_doc["city"] in ("Pune", "SAJJAN ASSOCIATES SHOP-7, STATION ROAD CHINCHWADGAO, Pune")
        assert lead_created_doc["state"] == "Maharashtra"
        assert lead_created_doc["country"] == "India"






