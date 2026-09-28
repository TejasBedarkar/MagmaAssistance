"""
web/apollo_client.py
--------------------
Client for Apollo.io B2B contact and company enrichment API.

Endpoints:
- POST https://api.apollo.io/v1/people/match
- POST https://api.apollo.io/v1/organizations/enrich
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("apollo-client")

APOLLO_API_URL = "https://api.apollo.io/v1"
APOLLO_REQUEST_TIMEOUT = 12

_STOP_WORDS = {"inc", "ltd", "corp", "corporation", "co", "pvt", "private", "limited", "the", "llc", "technologies", "solutions"}


def _clean_domain(domain_or_url: Optional[str]) -> Optional[str]:
    """Extract clean domain (e.g. 'zerodha.com') from URL or raw string."""
    if not domain_or_url:
        return None
    val = domain_or_url.strip().lower()
    if val.startswith("http://") or val.startswith("https://"):
        try:
            parsed = urlparse(val)
            val = parsed.netloc or val
        except Exception:
            pass
    if val.startswith("www."):
        val = val[4:]
    return val.rstrip("/") or None


def _is_valid_org_match(expected_company: str, org: Dict[str, Any]) -> bool:
    """Verify that Apollo's returned organization is actually related to the queried company."""
    if not expected_company:
        return True
    exp = expected_company.lower().strip()
    name = (org.get("name") or "").lower().strip()
    primary_domain = (org.get("primary_domain") or "").lower().strip()

    if exp in name or name in exp:
        return True

    exp_words = set(re.findall(r"\w+", exp)) - _STOP_WORDS
    name_words = set(re.findall(r"\w+", name)) - _STOP_WORDS
    if exp_words and (exp_words & name_words):
        return True

    domain_stem = primary_domain.split(".")[0] if primary_domain else ""
    if domain_stem and (exp == domain_stem or domain_stem in exp_words):
        return True

    return False


class ApolloClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (api_key or os.environ.get("APOLLO_API_KEY", "")).strip()

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Api-Key": self.api_key,
        }

    def match_person(
        self,
        name: str,
        organization_name: Optional[str] = None,
        domain: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Query Apollo.io /v1/people/match to find a specific individual within an organization.
        Note: Requires an Apollo Paid plan. Returns None if unconfigured, on Free plan, or not found.
        """
        if not self.is_configured():
            logger.warning("Apollo API key is not configured.")
            return None

        clean_dom = _clean_domain(domain)
        # If domain not provided, try common domain heuristic (e.g. 'microsoft' -> 'microsoft.com')
        if not clean_dom and organization_name and " " not in organization_name.strip():
            clean_dom = f"{organization_name.strip().lower()}.com"

        payload: Dict[str, Any] = {
            "name": name.strip(),
            "reveal_personal_emails": True,
        }
        if organization_name:
            payload["organization_name"] = organization_name.strip()
        if clean_dom:
            payload["domain"] = clean_dom

        parts = name.strip().split()
        if len(parts) >= 2:
            payload["first_name"] = parts[0]
            payload["last_name"] = " ".join(parts[1:])

        url = f"{APOLLO_API_URL}/people/match"
        try:
            resp = requests.post(
                url,
                json=payload,
                headers=self._headers(),
                timeout=APOLLO_REQUEST_TIMEOUT,
            )
            if resp.status_code == 401:
                logger.error("Apollo.io authentication failed: 401 Unauthorized.")
                return None
            if resp.status_code == 403:
                logger.info("Apollo /v1/people/match is not accessible on the current Apollo plan (requires paid tier).")
                return None
            if resp.status_code == 429:
                logger.warning("Apollo.io rate limit or credit limit exceeded (429).")
                return None
            if resp.status_code != 200:
                logger.info("Apollo people/match returned status %d: %s", resp.status_code, resp.text[:200])
                return None

            data = resp.json() or {}
            person = data.get("person")
            if not person or not isinstance(person, dict):
                return None

            return self._normalize_person_data(person, default_company=organization_name)
        except requests.exceptions.Timeout:
            logger.warning("Apollo.io match_person timed out.")
            return None
        except Exception as exc:
            logger.exception("Apollo.io match_person failed: %s", exc)
            return None

    def enrich_organization(
        self,
        domain: Optional[str] = None,
        company_name: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Query Apollo.io /v1/organizations/enrich to get company details, phone, and address.
        Returns parsed normalized dictionary if company is found and verified, else None.
        """
        if not self.is_configured():
            logger.warning("Apollo API key is not configured.")
            return None

        clean_dom = _clean_domain(domain)
        clean_name = (company_name or "").strip()
        if not clean_dom and not clean_name:
            return None

        # If domain is not known, try a fast domain heuristic for single-word company names (e.g. 'Microsoft' -> 'microsoft.com')
        domains_to_try = [clean_dom] if clean_dom else []
        if not clean_dom and clean_name and " " not in clean_name:
            domains_to_try.append(f"{clean_name.lower()}.com")

        # 1. Try with domain if available
        url = f"{APOLLO_API_URL}/organizations/enrich"
        for dom_candidate in domains_to_try:
            if not dom_candidate:
                continue
            try:
                resp = requests.post(
                    url,
                    json={"domain": dom_candidate},
                    headers=self._headers(),
                    timeout=APOLLO_REQUEST_TIMEOUT,
                )
                if resp.status_code == 200:
                    data = resp.json() or {}
                    org = data.get("organization")
                    if org and isinstance(org, dict) and _is_valid_org_match(clean_name, org):
                        return self._normalize_organization_data(org, default_name=clean_name)
            except Exception as e:
                logger.debug("Domain lookup for %s failed: %s", dom_candidate, e)

        # 2. Try with name if domain lookup didn't match
        if clean_name:
            try:
                resp = requests.post(
                    url,
                    json={"name": clean_name},
                    headers=self._headers(),
                    timeout=APOLLO_REQUEST_TIMEOUT,
                )
                if resp.status_code == 401:
                    logger.error("Apollo.io authentication failed: 401 Unauthorized.")
                    return None
                if resp.status_code == 429:
                    logger.warning("Apollo.io rate limit or credit limit exceeded (429).")
                    return None
                if resp.status_code == 200:
                    data = resp.json() or {}
                    org = data.get("organization")
                    if org and isinstance(org, dict) and _is_valid_org_match(clean_name, org):
                        return self._normalize_organization_data(org, default_name=clean_name)
                    else:
                        logger.info("Apollo returned non-matching organization for '%s' — ignoring false positive.", clean_name)
            except requests.exceptions.Timeout:
                logger.warning("Apollo.io enrich_organization timed out.")
                return None
            except Exception as exc:
                logger.exception("Apollo.io enrich_organization failed: %s", exc)
                return None

        return None

    def _normalize_person_data(
        self,
        person: Dict[str, Any],
        default_company: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Normalize Apollo person response into standardized ERP lead fields."""
        full_name = person.get("name") or f"{person.get('first_name', '')} {person.get('last_name', '')}".strip()
        email = person.get("email") or ""
        designation = person.get("title") or ""
        linkedin = person.get("linkedin_url") or ""

        phone = person.get("sanitized_phone") or ""
        if not phone:
            phone_numbers = person.get("phone_numbers") or []
            for p in phone_numbers:
                if isinstance(p, dict):
                    num = p.get("sanitized_number") or p.get("raw_number")
                    if num:
                        phone = num
                        break

        org = person.get("organization") or {}
        comp_name = org.get("name") or default_company or ""
        website = org.get("website_url") or (f"https://{org.get('primary_domain')}" if org.get("primary_domain") else "")
        org_phone = (
            org.get("primary_phone", {}).get("number")
            if isinstance(org.get("primary_phone"), dict)
            else org.get("phone") or org.get("sanitized_phone")
        ) or ""

        street = org.get("street_address") or org.get("raw_address") or ""
        city = org.get("city") or ""
        state = org.get("state") or ""
        pincode = org.get("postal_code") or ""
        country = org.get("country") or ""
        desc = org.get("short_description") or ""

        return {
            "lead_name": full_name,
            "designation": designation,
            "email_id": email,
            "mobile_no": phone,
            "company_name": comp_name,
            "website": website,
            "phone": org_phone,
            "address_line1": street,
            "city": city,
            "state": state,
            "pincode": pincode,
            "country": country,
            "description": desc,
            "linkedin_url": linkedin,
            "has_direct_email": bool(email),
            "has_direct_phone": bool(phone),
        }

    def _normalize_organization_data(
        self,
        org: Dict[str, Any],
        default_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Normalize Apollo organization response into standardized ERP fields."""
        comp_name = org.get("name") or default_name or ""
        website = org.get("website_url") or (f"https://{org.get('primary_domain')}" if org.get("primary_domain") else "")
        phone = (
            org.get("primary_phone", {}).get("number")
            if isinstance(org.get("primary_phone"), dict)
            else org.get("phone") or org.get("sanitized_phone")
        ) or ""

        street = org.get("street_address") or org.get("raw_address") or ""
        city = org.get("city") or ""
        state = org.get("state") or ""
        pincode = org.get("postal_code") or ""
        country = org.get("country") or ""
        desc = org.get("short_description") or ""
        linkedin = org.get("linkedin_url") or ""
        email = org.get("email") or ""

        return {
            "lead_name": "",
            "designation": "",
            "email_id": email,
            "mobile_no": "",
            "company_name": comp_name,
            "website": website,
            "phone": phone,
            "address_line1": street,
            "city": city,
            "state": state,
            "pincode": pincode,
            "country": country,
            "description": desc,
            "linkedin_url": linkedin,
            "has_direct_email": False,
            "has_direct_phone": False,
        }
