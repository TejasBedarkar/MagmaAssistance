"""
zaubacorp.py
------------
Autonomous fallback module to fetch company contact and registration details
from ZaubaCorp (Ministry of Corporate Affairs / MCA records for Indian companies).

Provides:
  - search_zaubacorp(company_name, domain): Finds the official ZaubaCorp profile URL.
  - fetch_zaubacorp_html(url): Retrieves page HTML via HTTP or Playwright headless browser.
  - parse_zaubacorp_page(html, url): Extracts registered email, address, CIN, and directors.
  - lookup_zaubacorp_fallback(company_name, domain): End-to-end lookup and extraction.
"""

from __future__ import annotations

import logging
import os
import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

from .resolver import REQUEST_TIMEOUT
from .crawler import _SESSION, fetch_rendered_html
from .extractor import (
    EMAIL_RE,
    parse_address_fields,
    _is_low_value_email,
    pick_primary_email,
)

logger = logging.getLogger("company_crawler.zaubacorp")

# Indian CIN Regex: e.g. U72200MH2018PTC123456 or L22210MH1995PLC084781
CIN_RE = re.compile(r"\b([L|U]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b", re.IGNORECASE)

# ZaubaCorp domains and URLs to ignore
_ZAUBACORP_INTERNAL_EMAILS = {"support@zaubacorp.com", "info@zaubacorp.com", "contact@zaubacorp.com"}


@dataclass
class ZaubaCorpData:
    legal_name: Optional[str] = None
    cin: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    parsed_address: Optional[dict] = None
    directors: list[str] = field(default_factory=list)
    company_status: Optional[str] = None
    zauba_url: Optional[str] = None

    def has_contact_info(self) -> bool:
        return bool(self.email or self.address)


def _clean_company_query(name: str) -> str:
    """Sanitize company name for optimal search on ZaubaCorp."""
    cleaned = (name or "").strip()
    cleaned = re.sub(r"[\"\'\(\)\[\]\{\}]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _score_zaubacorp_candidate(url: str, company_name: str) -> int:
    """Score a ZaubaCorp URL candidate based on similarity to company_name."""
    name_tokens = [
        t.lower() for t in re.split(r"[\s._\-]+", company_name.strip())
        if len(t) >= 2 and t.lower() not in ("private", "limited", "pvt", "ltd", "llp", "inc", "corp", "company")
    ]
    if not name_tokens:
        return 0

    url_lower = url.lower()
    score = 0

    # Match tokens in URL
    for tok in name_tokens:
        if tok in url_lower:
            score += 30
        else:
            score -= 20

    # Penalize common unrelated filler sectors
    penalties = [
        "hr", "consultant", "garments", "logistics", "infra", "pharma",
        "holdings", "finance", "capital", "ventures", "textiles", "builders",
        "motors", "security", "foods", "pharma", "agro"
    ]
    for pen in penalties:
        if pen in url_lower and pen not in name_tokens:
            score -= 15

    # Check if all tokens appear as a consecutive hyphenated slug
    slug = "-".join(name_tokens)
    if slug in url_lower:
        score += 40

    return score


def search_zaubacorp(company_name: str, domain: Optional[str] = None) -> Optional[str]:
    """
    Find the most relevant ZaubaCorp company profile URL for a given company name.
    Uses Tavily or SearXNG with token-similarity scoring across candidate URLs.
    """
    if not company_name:
        return None

    clean_name = _clean_company_query(company_name)
    queries = [
        f'site:zaubacorp.com "{clean_name}"',
        f"{clean_name} zaubacorp",
        f"{clean_name} Private Limited zaubacorp",
    ]

    candidates: list[str] = []
    tavily_key = os.environ.get("TAVILY_API_KEY", "")

    for query in queries:
        # 1. Try Tavily search if available
        if tavily_key:
            try:
                from tavily import TavilyClient
                client = TavilyClient(api_key=tavily_key)
                resp = client.search(query=query, max_results=5, search_depth="basic")
                for r in resp.get("results", []):
                    url = r.get("url", "")
                    if "zaubacorp.com" in url.lower() and not any(x in url.lower() for x in ["company-by-address", "company-directors", "company-update", "company-category", "companies-"]):
                        if url not in candidates:
                            candidates.append(url)
            except Exception as e:
                logger.debug("Tavily search for zaubacorp failed: %s", e)

        # 2. Try SearXNG fallback if candidates are empty
        if not candidates:
            searxng_url = os.environ.get("SEARXNG_URL", "http://localhost:8080")
            try:
                resp = requests.get(
                    f"{searxng_url}/search",
                    params={"q": query, "format": "json"},
                    timeout=3,
                )
                if resp.status_code == 200:
                    results = resp.json().get("results", [])
                    for r in results:
                        url = r.get("url", "")
                        if "zaubacorp.com" in url.lower() and not any(x in url.lower() for x in ["company-by-address", "company-directors", "company-update", "company-category", "companies-"]):
                            if url not in candidates:
                                candidates.append(url)
            except Exception as e:
                logger.debug("SearXNG search for zaubacorp failed: %s", e)

        if candidates:
            break

    if not candidates:
        return None

    scored = sorted(
        [{"url": u, "score": _score_zaubacorp_candidate(u, clean_name)} for u in candidates],
        key=lambda x: x["score"],
        reverse=True,
    )

    if scored and scored[0]["score"] > 0:
        return scored[0]["url"]

    return candidates[0] if candidates else None


def fetch_zaubacorp_html(url: str) -> tuple[str, str]:
    """
    Fetch the ZaubaCorp page. Uses plain HTTP first, falling back to
    Playwright headless browser if Cloudflare or JS challenge is detected.
    """
    try:
        resp = _SESSION.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True, verify=False)
        if resp.status_code == 200 and resp.text:
            text = resp.text
            # Check for Cloudflare challenge markers
            if "Just a moment..." in text or "Enable JavaScript and cookies" in text or "cf-browser-verification" in text:
                logger.info("ZaubaCorp returned Cloudflare challenge on %s, attempting Playwright fallback...", url)
                rendered = fetch_rendered_html(url)
                if rendered:
                    return rendered, "browser"
            return text, "http"
        elif resp.status_code in (403, 503):
            logger.info("ZaubaCorp HTTP %s for %s, falling back to Playwright...", resp.status_code, url)
            rendered = fetch_rendered_html(url)
            if rendered:
                return rendered, "browser"
    except Exception as exc:
        logger.debug("HTTP fetch failed for ZaubaCorp %s (%s), trying browser fallback...", url, exc)
        rendered = fetch_rendered_html(url)
        if rendered:
            return rendered, "browser"

    return "", "failed"


def parse_zaubacorp_page(html: str, url: Optional[str] = None) -> ZaubaCorpData:
    """
    Extracts structured data from a ZaubaCorp company profile page:
      - Legal Name
      - CIN
      - Registered Email ID
      - Registered Office Address
      - Parsed Address Dict
      - Directors / Key Management Personnel
      - Company Status
    """
    data = ZaubaCorpData(zauba_url=url)
    if not html:
        return data

    soup = BeautifulSoup(html, "lxml")

    # 1. Legal Company Name
    h1 = soup.find("h1")
    if h1:
        legal_name = h1.get_text(" ", strip=True)
        data.legal_name = legal_name
    elif soup.title:
        title_text = soup.title.get_text(strip=True)
        data.legal_name = title_text.split(" - ")[0].split("|")[0].strip()

    # 2. CIN extraction
    cin_match = CIN_RE.search(html)
    if cin_match:
        data.cin = cin_match.group(1).upper()

    # 3. Locate the specific 'Contact Details of <Company>' section
    contact_sec = soup.find(id=re.compile(r"contact-details", re.IGNORECASE))
    if not contact_sec:
        for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "button", "div"]):
            if "contact details of" in h.get_text().lower():
                parent_container = h.find_parent("div", class_=re.compile(r"accordion-item|card|panel|section|box")) or h.find_parent("div")
                if parent_container:
                    contact_sec = parent_container
                    break

    # 4. Extract Email & Address from the Contact Details Section
    if contact_sec:
        # A. Cloudflare-obfuscated email in contact_sec
        from .extractor import _decode_cloudflare_email
        for el in contact_sec.find_all(attrs={"data-cfemail": True}):
            cf_val = el.get("data-cfemail")
            dec = _decode_cloudflare_email(cf_val)
            if dec and not _is_low_value_email(dec) and dec not in _ZAUBACORP_INTERNAL_EMAILS:
                data.email = dec
                break

        # B. Check for mailto: links in contact_sec
        if not data.email:
            for a in contact_sec.find_all("a", href=True):
                href = a["href"].strip()
                if href.startswith("mailto:"):
                    em = href[7:].split("?")[0].strip().lower()
                    if em and not _is_low_value_email(em) and em not in _ZAUBACORP_INTERNAL_EMAILS:
                        data.email = em
                        break

        # C. Scan list items / rows in contact_sec
        for item in contact_sec.find_all(["li", "tr", "div"]):
            spans = item.find_all(["span", "label", "td", "th", "p"])
            if len(spans) >= 2:
                label_text = spans[0].get_text(strip=True).lower()
                val_text = spans[1].get_text(" ", strip=True)

                if "email" in label_text and not data.email:
                    if "@" in val_text and "[email" not in val_text:
                        for m in EMAIL_RE.findall(val_text):
                            em = m.strip().lower()
                            if em and not _is_low_value_email(em) and em not in _ZAUBACORP_INTERNAL_EMAILS:
                                data.email = em
                                break
                elif "address" in label_text and "same address" not in label_text and not data.address:
                    if len(val_text) > 10 and "not available" not in val_text.lower():
                        data.address = val_text.strip()

        # D. Check Google Map iframe in contact_sec if address text was not found
        if not data.address:
            iframe = contact_sec.find("iframe", src=re.compile(r"maps/embed.*q="))
            if iframe:
                parsed_src = urllib.parse.urlparse(iframe["src"])
                qs = urllib.parse.parse_qs(parsed_src.query)
                if "q" in qs and qs["q"]:
                    data.address = urllib.parse.unquote_plus(qs["q"][0]).strip()

    # 5. Fallback for older / alternate templates if contact_sec was missing
    if not data.email:
        from .extractor import _decode_cloudflare_email
        for el in soup.find_all(attrs={"data-cfemail": True}):
            dec = _decode_cloudflare_email(el.get("data-cfemail"))
            if dec and not _is_low_value_email(dec) and dec not in _ZAUBACORP_INTERNAL_EMAILS:
                data.email = dec
                break
        if not data.email:
            for a in soup.find_all("a", href=True):
                href = a["href"].strip()
                if href.startswith("mailto:"):
                    em = href[7:].split("?")[0].strip().lower()
                    if em and not _is_low_value_email(em) and em not in _ZAUBACORP_INTERNAL_EMAILS:
                        data.email = em
                        break

    if not data.address:
        # Strictly look for registered office headers (excluding RoC / Registrar / Same Address)
        address_headers = soup.find_all(
            lambda tag: tag.name in ["h4", "h5", "strong", "b", "td", "th", "span"]
            and ("address" in tag.get_text().lower() or "registered office" in tag.get_text().lower())
            and not any(x in tag.get_text().lower() for x in ["roc", "registrar", "same address", "email", "grievance"])
        )
        for hdr in address_headers:
            nxt = hdr.find_next_sibling(["p", "div", "span", "td"])
            if nxt:
                txt = nxt.get_text(" ", strip=True)
                if len(txt) > 15 and re.search(r"\d{6}", txt):
                    data.address = txt
                    break
            parent = hdr.parent
            if parent:
                if hdr.name in ("strong", "b", "span") and parent.name in ("p", "div", "td"):
                    txt = parent.get_text(" ", strip=True)
                    if len(txt) > 15 and re.search(r"\d{6}", txt):
                        data.address = txt
                        break

    # Clean address and parse fields
    if data.address:
        cleaned_addr = re.sub(r"^(?:registered\s+)?address\s*[:\-]?\s*", "", data.address, flags=re.IGNORECASE).strip()
        cleaned_addr = re.sub(r"\s+", " ", cleaned_addr)
        data.address = cleaned_addr

        parsed = parse_address_fields(cleaned_addr)
        if parsed:
            data.parsed_address = parsed.as_dict()

    # 6. Extract Directors
    directors: list[str] = []
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) >= 2:
            row_texts = [td.get_text(" ", strip=True) for td in tds]
            if any(re.match(r"^\d{8}$", t) for t in row_texts):
                for t in row_texts:
                    if len(t) > 3 and not re.match(r"^\d+$", t) and not any(kw in t.lower() for kw in ["director", "signatory", "appointed", "active"]):
                        clean_dir = re.sub(r"\s+", " ", t).strip()
                        if clean_dir and clean_dir not in directors:
                            directors.append(clean_dir)
                            break

    data.directors = directors[:5]

    # 7. Company Status
    page_text = soup.get_text(" ", strip=True)
    status_match = re.search(r"Company Status\s*[:\-]?\s*([A-Za-z\s]+)", page_text, re.IGNORECASE)
    if status_match:
        data.company_status = status_match.group(1).strip().split()[0].strip()

    return data


def lookup_zaubacorp_fallback(company_name: str, domain: Optional[str] = None) -> Optional[ZaubaCorpData]:
    """
    Main orchestrator function:
    1. Finds ZaubaCorp profile URL for company_name.
    2. Fetches and parses the ZaubaCorp page.
    3. Returns structured ZaubaCorpData if found, or None.
    """
    if not company_name:
        return None

    zauba_url = search_zaubacorp(company_name, domain)
    if not zauba_url:
        logger.info("No ZaubaCorp profile found for '%s'.", company_name)
        return None

    logger.info("Found ZaubaCorp URL for '%s': %s", company_name, zauba_url)
    html, method = fetch_zaubacorp_html(zauba_url)
    if not html:
        logger.warning("Could not fetch ZaubaCorp page content for %s.", zauba_url)
        return None

    data = parse_zaubacorp_page(html, url=zauba_url)
    return data
