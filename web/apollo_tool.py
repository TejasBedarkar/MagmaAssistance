"""
web/apollo_tool.py
------------------
LangChain tool for B2B Lead Enrichment using Apollo.io as primary provider
with intelligent person-to-company fallback and web-crawler/ZaubaCorp safety net.

Flow:
1. If person_name is provided, query Apollo /v1/people/match.
   If verified direct person details (email/phone) are found -> use them.
2. If person is not found or lacks contact details -> query Apollo /v1/organizations/enrich.
   If company exists in Apollo -> use company phone/email/address, and notify the user
   that person-specific contact was unavailable so company info is used.
3. If company is NOT found in Apollo (or Apollo is not configured/unreachable) ->
   ONLY THEN trigger the Web Crawler / ZaubaCorp fallback!
4. Format all extracted details in a standard markdown review table with an explicit
   confirmation gate before ERP record creation.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from langchain_core.tools import tool

from .apollo_client import ApolloClient, _clean_domain
from .company_crawler.resolver import resolve_company_website
from .web_tool import web_company_extract, web_company_search

logger = logging.getLogger("apollo-tool")

_apollo_client = ApolloClient()


def _format_lead_table(
    data: Dict[str, Any],
    source_label: str,
    target_person: Optional[str] = None,
    is_company_fallback: bool = False,
    extra_notice: Optional[str] = None,
) -> str:
    """Format extracted lead details into the standardized Markdown review table."""
    def _row(field: str, val: Any, note: str = "") -> str:
        s = str(val or "").strip()
        v = s if s else "Not found"
        n = f" {note}" if note else ""
        return f"| {field} | {v}{n} |"

    table_rows = [
        "| Field | Value |",
        "| :--- | :--- |",
    ]

    lead_name = data.get("lead_name") or target_person or ""
    if lead_name:
        table_rows.append(_row("Contact Person", lead_name))
    if data.get("designation"):
        table_rows.append(_row("Designation", data.get("designation")))
    if data.get("company_name"):
        table_rows.append(_row("Company Name", data.get("company_name")))
    if data.get("email_id"):
        email_note = "(Verified Direct)" if data.get("has_direct_email") else "(Corporate)"
        table_rows.append(_row("Email", data.get("email_id"), email_note))
    else:
        table_rows.append(_row("Email", "Not found"))

    phone_val = data.get("mobile_no") or data.get("phone") or ""
    if phone_val:
        phone_note = "(Direct Dial)" if data.get("has_direct_phone") else "(Office)"
        table_rows.append(_row("Phone", phone_val, phone_note))
    else:
        table_rows.append(_row("Phone", "Not found"))

    if data.get("website"):
        table_rows.append(_row("Website", data.get("website")))
    if data.get("address_line1"):
        table_rows.append(_row("Address", data.get("address_line1")))
    if data.get("city"):
        table_rows.append(_row("City", data.get("city")))
    if data.get("state"):
        table_rows.append(_row("State", data.get("state")))
    if data.get("pincode"):
        table_rows.append(_row("Pincode", data.get("pincode")))
    if data.get("country"):
        table_rows.append(_row("Country", data.get("country")))
    if data.get("linkedin_url"):
        table_rows.append(_row("LinkedIn", data.get("linkedin_url")))
    if data.get("description"):
        desc = str(data["description"]).strip()
        table_rows.append(_row("Description", desc[:150] + ("..." if len(desc) > 150 else "")))

    header_lines = [
        "--- EXTRACTION COMPLETE ---",
        f"Source: {source_label}",
        "",
    ]

    if is_company_fallback and target_person:
        header_lines.append(
            f"*Note: Specific contact details for '{target_person}' were not found in Apollo.io. "
            f"Using the company's verified corporate contact and address instead.*"
        )
        header_lines.append("")

    if extra_notice:
        header_lines.append(f"{extra_notice}")
        header_lines.append("")

    footer_lines = [
        "",
        "--- ACTION REQUIRED ---",
        "Present the above details to the user in a clear table. Then STOP and wait.",
        "Ask: 'Do all these details look correct? Tell me if you want to change any field, or say \"proceed\" to create the lead.'",
        "Wait for user confirmation or corrections before calling erp_data_tool.",
        "If the user approves, call erp_data_tool(operation='create', web_enriched=True, approved=True) with ALL available fields.",
    ]

    return "\n".join(header_lines + table_rows + footer_lines)


def _dispatch_crawler(
    company_name: str,
    person_name: Optional[str] = None,
    domain: Optional[str] = None,
) -> str:
    """Trigger web crawler fallback when Apollo has no data."""
    if domain:
        target_url = f"https://{domain}" if not str(domain).startswith("http") else domain
        return web_company_extract.func(
            url=target_url,
            person_name=person_name,
            company_name=company_name,
        )
    return web_company_search.func(
        company_name=company_name,
    )


def enrich_lead_pipeline(
    company_name: str,
    person_name: Optional[str] = None,
    domain: Optional[str] = None,
    client: Optional[ApolloClient] = None,
    crawler_fn: Optional[Any] = None,
    resolver_fn: Optional[Any] = None,
) -> str:
    """Core enrichment logic decoupled for easy testing and tool execution."""
    c = client or _apollo_client
    crawler_dispatcher = crawler_fn or _dispatch_crawler
    resolve_domain = resolver_fn if resolver_fn is not None else resolve_company_website

    company = (company_name or "").strip()
    person = (person_name or "").strip() or None
    dom = _clean_domain(domain)

    # Check if company_name itself is a domain (e.g. 'zerodha.com')
    if not dom and ("." in company and not " " in company):
        dom = _clean_domain(company)

    # Fast heuristic: if company is a single word name, try company.com first
    if not dom and company and " " not in company and "." not in company:
        dom = f"{company.lower()}.com"

    apollo_available = c.is_configured()


    # =========================================================================
    # STEP 1: If person_name given, attempt Apollo Person Match
    # =========================================================================
    if apollo_available and person:
        logger.info("Querying Apollo.io for person '%s' at '%s' (domain: %s)...", person, company, dom)
        person_res = c.match_person(name=person, organization_name=company, domain=dom)
        if person_res and (person_res.get("email_id") or person_res.get("mobile_no") or person_res.get("phone")):
            logger.info("Apollo.io found direct person contact for '%s'.", person)
            return _format_lead_table(
                person_res,
                source_label="Apollo.io (Verified Direct Contact)",
                target_person=person,
                is_company_fallback=False,
            )

    # =========================================================================
    # STEP 2: If person not found or lacks contact, query Apollo Company Enrich
    # =========================================================================
    if apollo_available and (company or dom):
        logger.info("Querying Apollo.io organization enrichment for '%s' (domain: %s)...", company, dom)
        org_res = c.enrich_organization(domain=dom, company_name=company)
        if org_res and (org_res.get("phone") or org_res.get("address_line1") or org_res.get("city") or org_res.get("website")):
            logger.info("Apollo.io found organization details for '%s'.", company)
            # If user provided a person name, retain it as the lead name
            if person:
                org_res["lead_name"] = person
            return _format_lead_table(
                org_res,
                source_label="Apollo.io (Company Fallback)",
                target_person=person,
                is_company_fallback=bool(person),
            )

    # =========================================================================
    # STEP 3: Company NOT in Apollo -> Fallback to Web Crawler / ZaubaCorp
    # =========================================================================
    logger.info("Company '%s' not found in Apollo.io. Falling back to Web Crawler / ZaubaCorp...", company)
    notice = f"*Company '{company}' was not found in Apollo.io database. Triggering Web Crawler & ZaubaCorp fallback...*"

    crawler_output = crawler_dispatcher(company_name=company, person_name=person, domain=dom)
    return f"{notice}\n\n{crawler_output}"



@tool
def apollo_enrich_lead(
    company_name: str,
    person_name: Optional[str] = None,
    domain: Optional[str] = None,
) -> str:
    """Primary lead enrichment tool using Apollo.io with automatic fallback.

    Enrichment Workflow:
    1. If `person_name` is provided, searches Apollo.io for that specific person
       within `company_name` to retrieve direct work email, mobile number, designation, and HQ address.
    2. If the person is NOT found (or has no direct contact details), retrieves
       the company's corporate contact details (official email, phone, registered address)
       from Apollo.io and notes that company details are used.
    3. If the company is NOT found in Apollo.io, automatically triggers the Web Crawler
       and ZaubaCorp (MCA India registry) fallback.
    4. Presents the extracted details in a markdown review table for human confirmation.
    """
    comp = (company_name or "").strip()
    if not comp:
        return "Please provide a company name or website domain to enrich."

    return enrich_lead_pipeline(company_name=comp, person_name=person_name, domain=domain)
