"""
crawler.py
----------
Given a company's homepage URL, this module:
  1. Finds the most likely Contact / About-Us / Locations page(s) by:
     - Analyzing footer links and navigation anchors.
     - Scoring internal links using weighted contact keywords.
     - Actively probing targeted common subpaths (/contact, /contact-us, /about, /locations, etc.).
  2. Fetches page content — plain HTTP with realistic anti-bot browser headers first,
     falling back to a headless browser (Playwright) if the page looks JS-rendered / mostly empty.
"""

from __future__ import annotations

import json
import re
import urllib.robotparser as robotparser
from urllib.parse import urljoin, urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
from bs4 import BeautifulSoup

from .resolver import USER_AGENT, REQUEST_TIMEOUT

DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def _create_http_session() -> requests.Session:
    """Creates a requests.Session with connection pooling, modern anti-bot headers, and automatic retries."""
    session = requests.Session()
    retries = Retry(
        total=2,
        backoff_factor=0.3,
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=10)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update(DEFAULT_HEADERS)
    return session


_SESSION = _create_http_session()


def _allowed_by_robots(url: str) -> bool:
    """Best-effort robots.txt check. Fails open if robots.txt can't be fetched/parsed."""
    try:
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        resp = _SESSION.get(robots_url, timeout=3)
        if resp is not None and resp.status_code == 200 and resp.text:
            rp = robotparser.RobotFileParser()
            rp.parse(resp.text.splitlines())
            return rp.can_fetch(USER_AGENT, url)
        return True
    except Exception:
        return True


CONTACT_KEYWORDS = [
    "contact us", "contact-us", "contactus", "contact", "get in touch",
    "reach us", "reach out", "enquiry", "enquire", "support", "help",
    "connect with us", "talk to us", "about us", "about-us", "about",
    "office", "offices", "locations", "our locations", "our offices", "find us",
    "headquarters", "head office", "corporate office", "team", "leadership",
]

KEYWORD_WEIGHTS = {
    "contact us": 15, "contact-us": 15, "contactus": 15, "contact": 10,
    "get in touch": 10, "reach us": 9, "reach out": 8, "enquiry": 5,
    "enquire": 5, "connect with us": 7, "talk to us": 7,
    "locations": 8, "our locations": 9, "our offices": 9, "offices": 7,
    "find us": 6, "headquarters": 8, "head office": 8, "corporate office": 8,
    "about us": 4, "about-us": 4, "about": 3, "team": 4, "leadership": 4,
    "support": 2, "help": 1,
}

NEGATIVE_KEYWORDS = {
    "investor": 15, "investors": 15, "shareholder": 12, "whistleblower": 15,
    "audit committee": 15, "grievance": 10, "registrar": 12,
    "transfer agent": 12, "career": 10, "careers": 10, "job": 8, "jobs": 8,
    "press": 6, "media": 6, "csr": 8, "sustainability": 8, "policy": 6,
    "policies": 6, "terms": 8, "privacy": 8, "disclaimer": 8,
}

COMMON_TARGETED_SUBPATHS = [
    "/contact",
    "/contact-us",
    "/contactus",
    "/about",
    "/about-us",
    "/about/contact",
    "/locations",
    "/our-locations",
    "/offices",
    "/our-offices",
    "/reach-us",
    "/find-us",
    "/team",
    "/leadership",
]


def _get(url: str) -> requests.Response | None:
    if not _allowed_by_robots(url):
        return None
    try:
        return _SESSION.get(
            url, timeout=REQUEST_TIMEOUT, allow_redirects=True, verify=False
        )
    except Exception:
        return None


def _extract_spa_json_payloads(soup: BeautifulSoup) -> str:
    """Extracts text and contact blobs from Next.js, Nuxt, and embedded JSON scripts."""
    extracted_text = []
    for tag in soup.find_all("script", attrs={"id": re.compile(r"(__NEXT_DATA__|__NUXT_DATA__)")}):
        if tag.string:
            extracted_text.append(tag.string)
    for tag in soup.find_all("script", attrs={"type": "application/json"}):
        if tag.string and len(tag.string) < 50000:
            extracted_text.append(tag.string)
    return "\n".join(extracted_text)


def _looks_js_rendered(html: str) -> bool:
    """Heuristic: very little text content relative to script tags -> likely SPA."""
    soup = BeautifulSoup(html, "lxml")
    text_len = len(soup.get_text(strip=True))
    script_count = len(soup.find_all("script"))
    body = soup.find("body")
    body_children = len(body.find_all(True)) if body else 0
    return text_len < 200 or (script_count > 5 and body_children < 15)


def fetch_rendered_html(url: str) -> str | None:
    """
    Fetch a page with a real (headless) browser for JS-heavy sites if Playwright is available.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(
                user_agent=USER_AGENT,
                extra_http_headers={
                    "Accept-Language": "en-US,en;q=0.9",
                }
            )
            page.goto(url, timeout=15000, wait_until="networkidle")
            html = page.content()
            browser.close()
            return html
    except Exception:
        return None


def _extract_footer_links(soup: BeautifulSoup, base_url: str, parsed_home) -> dict[str, tuple[int, str]]:
    """Extract and prioritize contact, about, and location links located inside footer elements."""
    footer_scored = {}
    footer_elements = soup.find_all(["footer", "nav"]) + soup.select('[class*="footer"], [id*="footer"]')
    
    for container in footer_elements:
        for a in container.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            full_url = urljoin(base_url, href)
            parsed = urlparse(full_url)
            if parsed.netloc and parsed.netloc.split(":")[0] not in parsed_home.netloc and \
               parsed_home.netloc.split(":")[0] not in parsed.netloc:
                continue

            anchor_text = a.get_text(" ", strip=True).lower()
            path_text = parsed.path.lower().replace("-", " ").replace("_", " ").replace("/", " ")
            haystack = f"{anchor_text} {path_text}"

            score = 0
            for kw, weight in KEYWORD_WEIGHTS.items():
                if kw in haystack:
                    # Footer links get a 5-point bonus because corporate footers standardly host primary contact URLs
                    score += weight + 5
            for kw, penalty in NEGATIVE_KEYWORDS.items():
                if kw in haystack:
                    score -= penalty

            if score > 0:
                key = full_url.split("#")[0].rstrip("/")
                if key not in footer_scored or score > footer_scored[key][0]:
                    footer_scored[key] = (score, f"footer: {anchor_text or path_text}")

    return footer_scored


def find_contact_pages(homepage_url: str, max_pages: int = 3) -> list[dict]:
    """
    Crawl the homepage, score internal and footer links by contact-related keywords,
    probe targeted common subpaths, and return the top contact candidate page(s).
    """
    resp = _get(homepage_url)
    parsed_home = urlparse(homepage_url)
    base = f"{parsed_home.scheme}://{parsed_home.netloc}"

    scored_links: dict[str, tuple[int, str]] = {}

    if resp is not None and resp.status_code < 400:
        soup = BeautifulSoup(resp.text, "lxml")

        # 1. Extract from footer / navigation with priority
        footer_links = _extract_footer_links(soup, base, parsed_home)
        scored_links.update(footer_links)

        # 2. Extract from all other homepage links
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            full_url = urljoin(base, href)
            parsed = urlparse(full_url)
            # Stay on the same registered domain
            if parsed.netloc and parsed.netloc.split(":")[0] not in parsed_home.netloc and \
               parsed_home.netloc.split(":")[0] not in parsed.netloc:
                continue

            anchor_text = a.get_text(" ", strip=True).lower()
            path_text = parsed.path.lower().replace("-", " ").replace("_", " ").replace("/", " ")
            haystack = f"{anchor_text} {path_text}"

            score = 0
            for kw, weight in KEYWORD_WEIGHTS.items():
                if kw in haystack:
                    score += weight
            for kw, penalty in NEGATIVE_KEYWORDS.items():
                if kw in haystack:
                    score -= penalty

            if score > 0:
                key = full_url.split("#")[0].rstrip("/")
                if key not in scored_links or score > scored_links[key][0]:
                    scored_links[key] = (score, anchor_text or path_text)

    # 3. Targeted Sub-paths fallback/supplement
    # If scored links are fewer than max_pages, probe targeted common subpaths
    if len(scored_links) < max_pages:
        for subpath in COMMON_TARGETED_SUBPATHS:
            target_url = urljoin(base, subpath)
            clean_key = target_url.rstrip("/")
            if clean_key not in scored_links:
                scored_links[clean_key] = (2, f"targeted subpath: {subpath}")

    ranked = sorted(
        [{"url": u, "score": s, "anchor_text": t} for u, (s, t) in scored_links.items()],
        key=lambda x: x["score"], reverse=True,
    )

    return ranked[:max_pages]


def get_page_html(url: str) -> tuple[str, str]:
    """
    Returns (html, method) where method is 'http' or 'browser'.
    Appends any embedded Next.js / Nuxt SPA JSON state to ensure client-rendered
    contact info is extractable even without a headless browser.
    """
    resp = _get(url)
    html = resp.text if resp is not None and resp.status_code < 400 else ""

    if html:
        soup = BeautifulSoup(html, "lxml")
        spa_payload = _extract_spa_json_payloads(soup)
        if spa_payload:
            html += f"\n<!-- SPA_PAYLOAD_DATA: {spa_payload} -->"

    if not html or _looks_js_rendered(html):
        rendered = fetch_rendered_html(url)
        if rendered:
            return rendered, "browser"

    return html, "http"