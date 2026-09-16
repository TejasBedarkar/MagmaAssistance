"""
web/scraper.py

HTML fetching, sanitization, parsing, robots.txt checks, and metadata/contact
extraction helpers for the web tool package.
"""

import json
import logging
import os
import re
from typing import Optional
from urllib.parse import urljoin, urlparse
import urllib.robotparser as robotparser

from bs4 import BeautifulSoup
from dotenv import load_dotenv
import requests

load_dotenv()

logger = logging.getLogger("web-tools")

# ---------------------------------------------------------------------------
# Search clients & network configuration
# ---------------------------------------------------------------------------
_TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
_tavily_client = None
if _TAVILY_API_KEY:
    try:
        from tavily import TavilyClient
        _tavily_client = TavilyClient(api_key=_TAVILY_API_KEY)
        logger.info("Tavily search client initialized.")
    except Exception as _e:
        logger.warning("Tavily import failed (%s) — falling back to SearXNG.", _e)
else:
    logger.info("TAVILY_API_KEY not set — using SearXNG.")

_SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 MagmaAssistant/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_REQUEST_TIMEOUT = 12
_MAX_SEARCH_RESULTS = 8
_MAX_PAGE_CHARS = 8000
_MAX_CRAWL_PAGES = 10
_CRAWL_PAGE_CHARS = 2000

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
_EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE,
)

_PHONE_RE = re.compile(
    r"(?:"
    r"\+91[\s\-]?\d{5}[\s\-]?\d{5}"
    r"|\+91[\s\-]?\d{10}"
    r"|\+\d{1,3}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}"
    r"|0\d{2,4}[\s\-]\d{6,8}"
    r"|\b[6-9]\d{9}\b"
    r")"
)

_GENERIC_EMAIL_PREFIXES = {
    "noreply", "no-reply", "donotreply", "webmaster", "postmaster", "abuse",
    "mailer-daemon", "newsletter", "updates", "notifications",
}

_CONTACT_LINK_HINTS = (
    "contact", "reach us", "get in touch", "contact-us", "contactus",
    "about", "about-us", "aboutus", "team", "our-team", "ourteam",
    "connect", "reach", "talk to us",
)

_NON_OFFICIAL_HOSTS = {
    "wikipedia.org", "wikimedia.org", "linkedin.com", "facebook.com",
    "twitter.com", "x.com", "instagram.com", "youtube.com",
    "crunchbase.com", "bloomberg.com", "reuters.com", "indiamart.com",
    "glassdoor.com", "glassdoor.co.in", "zoominfo.com", "owler.com",
    "craft.co", "medium.com", "quora.com", "reddit.com", "yelp.com",
    "tradeindia.com", "justdial.com", "opencorporates.com", "dnb.com",
    "google.com", "bing.com", "duckduckgo.com", "britannica.com",
    "forbes.com", "investopedia.com", "wsj.com", "ambitionbox.com",
    "tracxn.com", "tofler.in", "vccircle.com", "moneycontrol.com",
}

_SOCIAL_PATTERNS = {
    "linkedin": re.compile(r"linkedin\.com/company/", re.I),
    "twitter": re.compile(r"(?:twitter|x)\.com/(?!share|intent)[a-zA-Z0-9_]{1,50}", re.I),
    "instagram": re.compile(r"instagram\.com/[a-zA-Z0-9_.]{1,50}", re.I),
    "youtube": re.compile(r"youtube\.com/(?:c/|channel/|user/|@)[a-zA-Z0-9_\-]{1,100}", re.I),
    "facebook": re.compile(r"facebook\.com/(?!sharer|share)[a-zA-Z0-9.]{1,100}", re.I),
}


# ---------------------------------------------------------------------------
# Scraping & Extraction Helpers
# ---------------------------------------------------------------------------
def _safe_call(action, fn):
    try:
        return fn()
    except requests.exceptions.Timeout:
        return f"Timed out while trying to {action}."
    except requests.exceptions.RequestException as exc:
        return f"Could not {action}: {exc}"
    except Exception as exc:
        logger.exception("web tool failed: %s", action)
        return f"Could not {action}: {exc}"


def _clean_text(soup):
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "form"]):
        tag.decompose()
    lines = [l.strip() for l in soup.get_text(separator="\n").splitlines()]
    return "\n".join(l for l in lines if l)


def _page_title(soup, fallback):
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    return fallback


def _allowed_by_robots(url):
    try:
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = robotparser.RobotFileParser()
        rp.set_url(robots_url)
        rp.read()
        return rp.can_fetch(_HEADERS["User-Agent"], url)
    except Exception:
        return True


def _is_non_official_host(netloc):
    host = netloc.lower()
    return any(host == h or host.endswith("." + h) for h in _NON_OFFICIAL_HOSTS)


def _fetch_soup(url):
    if _tavily_client:
        try:
            res = _tavily_client.extract(urls=[url])
            results = res.get("results", [])
            if results and results[0].get("raw_content"):
                markdown = results[0]["raw_content"]
                html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', markdown)
                html_doc = f"<html><body><p>{html}</p></body></html>"
                return BeautifulSoup(html_doc, "html.parser")
        except Exception as e:
            logger.warning("Tavily extract failed for %s: %s", url, e)

    try:
        resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
        ct = resp.headers.get("Content-Type", "")
        if "html" not in ct and "text" not in ct:
            return None
        return BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return None


def _extract_from_schema(item, emails, phones, socials, addresses):
    if not isinstance(item, dict):
        return

    if item.get("@type") == "PostalAddress":
        addr_parts = []
        for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"):
            val = item.get(k)
            if val and isinstance(val, str):
                addr_parts.append(val)
        if addr_parts:
            full_addr = ", ".join(addr_parts)
            if full_addr not in addresses:
                addresses.append(full_addr)
    else:
        addr = item.get("address")
        if isinstance(addr, str) and addr not in addresses:
            addresses.append(addr)

    for field in ("email", "contactEmail"):
        v = item.get(field, "")
        if v and "@" in v and v.lower() not in emails:
            emails.append(v.lower())
    for field in ("telephone", "faxNumber", "contactTelephone"):
        v = item.get(field, "")
        if v and v not in phones:
            phones.append(v)
    same_as = item.get("sameAs", [])
    if isinstance(same_as, str):
        same_as = [same_as]
    for url in same_as:
        for platform, pattern in _SOCIAL_PATTERNS.items():
            if platform not in socials and pattern.search(url or ""):
                socials[platform] = url.split("?")[0].rstrip("/")
    for key in ("contactPoint", "address", "founder", "employee", "member"):
        child = item.get(key)
        if isinstance(child, dict):
            _extract_from_schema(child, emails, phones, socials, addresses)
        elif isinstance(child, list):
            for c in child:
                _extract_from_schema(c, emails, phones, socials, addresses)


def _extract_contacts_from_soup(soup):
    emails, phones, whatsapp, socials, addresses = [], [], [], {}, []
    page_text = soup.get_text(" ", strip=True)

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            addr = href.split(":", 1)[1].split("?")[0].strip().lower()
            local = addr.split("@")[0]
            if addr and local not in _GENERIC_EMAIL_PREFIXES and addr not in emails:
                emails.append(addr)
        elif href.lower().startswith("tel:"):
            num = re.sub(r"\s", "", href.split(":", 1)[1].strip())
            if num and num not in phones:
                phones.append(num)
        elif "wa.me" in href.lower() or "api.whatsapp.com/send" in href.lower():
            num = re.sub(r"\D", "", href)[-12:]
            if num and ("+" + num) not in whatsapp:
                whatsapp.append("+" + num)
        for platform, pattern in _SOCIAL_PATTERNS.items():
            if platform not in socials and pattern.search(href):
                full = urljoin("https://x.com", href) if href.startswith("/") else href
                socials[platform] = full.split("?")[0].rstrip("/")

    for match in _EMAIL_RE.finditer(page_text):
        addr = match.group().lower()
        local = addr.split("@")[0]
        if local not in _GENERIC_EMAIL_PREFIXES and addr not in emails:
            emails.append(addr)
    for match in _PHONE_RE.finditer(page_text):
        num = re.sub(r"[\s\-]", "", match.group())
        if num not in phones and len(num) >= 7:
            phones.append(num)

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                _extract_from_schema(item, emails, phones, socials, addresses)
        except Exception:
            pass

    for tag in soup.find_all("address"):
        text = tag.get_text(", ", strip=True)
        if text and len(text) < 150 and text not in addresses:
            addresses.append(text)

    return {
        "emails": list(dict.fromkeys(emails))[:5],
        "phones": list(dict.fromkeys(phones))[:5],
        "whatsapp": list(dict.fromkeys(whatsapp))[:3],
        "socials": socials,
        "addresses": list(dict.fromkeys(addresses))[:3],
    }


def _extract_description(soup):
    snippets = []
    for selector in [
        {"property": "og:description"},
        {"name": "description"},
    ]:
        tag = soup.find("meta", attrs=selector)
        if tag and tag.get("content", "").strip():
            desc = tag["content"].strip()
            if len(desc) > 40 and desc not in snippets:
                snippets.append(desc)

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                desc = item.get("description", "")
                if desc and len(desc) > 40 and desc not in snippets:
                    snippets.append(desc)
        except Exception:
            pass

    for p in soup.find_all("p"):
        text = p.get_text(" ", strip=True)
        if len(text) > 80 and text not in snippets:
            snippets.append(text)
        if len(snippets) >= 5:
            break

    return " | ".join(snippets)[:1000]


def _extract_person_names(soup):
    names = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict) and item.get("@type") in ("Person", "Employee"):
                    name = item.get("name", "").strip()
                    if name and name not in names:
                        names.append(name)
        except Exception:
            pass
    return names[:5]


def _find_subpage_links(soup, base_url, max_links=5):
    base_domain = urlparse(base_url).netloc
    found, seen = [], set()
    for a in soup.find_all("a", href=True):
        label = (a.get_text() or "").strip().lower()
        href = a["href"].lower()
        if any(hint in label or hint in href for hint in _CONTACT_LINK_HINTS):
            full_url = urljoin(base_url, a["href"]).split("#")[0]
            if (
                full_url.startswith("http")
                and urlparse(full_url).netloc == base_domain
                and full_url not in seen
                and full_url != base_url
            ):
                seen.add(full_url)
                found.append(full_url)
                if len(found) >= max_links:
                    break
    return found
