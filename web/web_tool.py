"""
web/web_tool.py

Generic internet-access tools for the agent.

Five tools:
  - web_search          : Tavily (primary) / SearXNG fallback
  - web_fetch_page      : fetch one URL → readable text
  - web_crawl           : multi-page crawler
  - web_company_search  : find candidate official URLs for a company name
  - web_company_extract : deep extraction of email, phone, description,
                          social profiles from a confirmed company URL

web_company_extract improvements v2:
  ✅ Regex email scan  (plain-text mentions, not just mailto: links)
  ✅ Regex phone scan  (Indian +91, international, 10-digit formats)
  ✅ JSON-LD / schema.org structured data (modern company sites)
  ✅ WhatsApp wa.me link detection
  ✅ Social profile extraction (LinkedIn, Twitter/X, Instagram, YouTube, Facebook)
  ✅ Auto-crawl up to 3 subpages (Contact, About, Team) before giving up
  ✅ 2-3 sentence company description (meta → JSON-LD → first paragraph)
  ✅ Person / lead name extraction from schema.org Person objects
"""

import concurrent.futures
import json
import logging
import os
import re
import time
from typing import Optional
from urllib.parse import urljoin, urlparse
import urllib.robotparser as robotparser

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from langchain_core.tools import tool

from .company_crawler.resolver import resolve_company_website
from .company_crawler.crawler import find_contact_pages, get_page_html
from .company_crawler.extractor import (
    extract_contact_info, filter_emails_to_domain,
    pick_primary_email, pick_primary_phone, pick_primary_address,
)
from .company_crawler.zaubacorp import lookup_zaubacorp_fallback

load_dotenv()

logger = logging.getLogger("web-tools")

# ---------------------------------------------------------------------------
# Tavily client
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

_REQUEST_TIMEOUT    = 12
_MAX_SEARCH_RESULTS = 8
_MAX_PAGE_CHARS     = 8000
_MAX_CRAWL_PAGES    = 10
_CRAWL_PAGE_CHARS   = 2000

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
_EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE
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
    "mailer-daemon", "newsletter", "updates", "notifications"
}

_CONTACT_LINK_HINTS = (
    "contact", "reach us", "get in touch", "contact-us", "contactus",
    "about", "about-us", "aboutus", "team", "our-team", "ourteam",
    "connect", "reach", "talk to us"
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
    "linkedin":  re.compile(r"linkedin\.com/company/", re.I),
    "twitter":   re.compile(r"(?:twitter|x)\.com/(?!share|intent)[a-zA-Z0-9_]{1,50}", re.I),
    "instagram": re.compile(r"instagram\.com/[a-zA-Z0-9_.]{1,50}", re.I),
    "youtube":   re.compile(r"youtube\.com/(?:c/|channel/|user/|@)[a-zA-Z0-9_\-]{1,100}", re.I),
    "facebook":  re.compile(r"facebook\.com/(?!sharer|share)[a-zA-Z0-9.]{1,100}", re.I),
}


# ---------------------------------------------------------------------------
# Helpers
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
    # 1. Attempt Tavily Extract to bypass bot protection and render JS
    if _tavily_client:
        try:
            res = _tavily_client.extract(urls=[url])
            results = res.get("results", [])
            if results and results[0].get("raw_content"):
                markdown = results[0]["raw_content"]
                # Convert markdown links [text](url) to HTML <a href="url">text</a>
                html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', markdown)
                # Ensure the text is parseable by beautifulsoup
                html_doc = f"<html><body><p>{html}</p></body></html>"
                return BeautifulSoup(html_doc, "html.parser")
        except Exception as e:
            logger.warning("Tavily extract failed for %s: %s", url, e)

    # 2. Fallback to standard requests if Tavily is unavailable or fails
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
        
    # Address extraction
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

    # 1. mailto:/tel:/wa.me links
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

    # 2. Regex scan of page text
    for match in _EMAIL_RE.finditer(page_text):
        addr = match.group().lower()
        local = addr.split("@")[0]
        if local not in _GENERIC_EMAIL_PREFIXES and addr not in emails:
            emails.append(addr)
    for match in _PHONE_RE.finditer(page_text):
        num = re.sub(r"[\s\-]", "", match.group())
        if num not in phones and len(num) >= 7:
            phones.append(num)

    # 3. JSON-LD / schema.org
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                _extract_from_schema(item, emails, phones, socials, addresses)
        except Exception:
            pass

    # HTML <address> tags
    for tag in soup.find_all("address"):
        text = tag.get_text(", ", strip=True)
        if text and len(text) < 150 and text not in addresses:
            addresses.append(text)

    return {
        "emails":   list(dict.fromkeys(emails))[:5],
        "phones":   list(dict.fromkeys(phones))[:5],
        "whatsapp": list(dict.fromkeys(whatsapp))[:3],
        "socials":  socials,
        "addresses": list(dict.fromkeys(addresses))[:3]
    }


def _extract_description(soup):
    """Gathers up to ~1000 chars of descriptive text from the page.
    The LLM will summarize this into a concise 2-3 sentences."""
    snippets = []
    
    # 1. Meta descriptions
    for selector in [
        {"property": "og:description"},
        {"name": "description"},
    ]:
        tag = soup.find("meta", attrs=selector)
        if tag and tag.get("content", "").strip():
            desc = tag["content"].strip()
            if len(desc) > 40 and desc not in snippets:
                snippets.append(desc)
                
    # 2. JSON-LD description
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
            
    # 3. Substantial paragraphs
    for p in soup.find_all("p"):
        text = p.get_text(" ", strip=True)
        if len(text) > 80 and text not in snippets:
            snippets.append(text)
        if len(snippets) >= 5:  # Cap at 5 snippets
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
            if (full_url.startswith("http")
                    and urlparse(full_url).netloc == base_domain
                    and full_url not in seen
                    and full_url != base_url):
                seen.add(full_url)
                found.append(full_url)
                if len(found) >= max_links:
                    break
    return found


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def web_search(query: str, max_results: int = 5) -> str:
    """Searches the public internet for up-to-date information — news, product
    specs, company lookups, documentation, etc. Uses Tavily (AI-optimized) as
    primary; falls back to local SearXNG. Returns numbered results with title,
    URL, snippet. Use web_fetch_page afterwards for full page content."""
    n = max(1, min(int(max_results or 5), _MAX_SEARCH_RESULTS))

    def run():
        if _tavily_client:
            try:
                resp = _tavily_client.search(query=query, max_results=n,
                    include_answer=True, include_raw_content=False, search_depth="advanced")
                results = resp.get("results", [])
                answer = resp.get("answer", "")
                if not results:
                    return f"No web results found for '{query}'."
                lines = [f"Web search results for '{query}':"]
                if answer:
                    lines.append(f"\n📋 Direct answer: {answer}\n")
                for i, r in enumerate(results, 1):
                    lines.append(f"{i}. {r.get('title','(no title)')}\n   {r.get('url','')}\n   {(r.get('content') or '').strip()[:400]}")
                return "\n".join(lines)
            except Exception as exc:
                logger.warning("Tavily failed (%s) — falling back to SearXNG.", exc)
        try:
            resp = requests.get(f"{_SEARXNG_URL}/search",
                params={"q": query, "format": "json"}, timeout=_REQUEST_TIMEOUT)
            resp.raise_for_status()
            results = resp.json().get("results", [])[:n]
        except Exception:
            return f"Web search unavailable for '{query}'."
        if not results:
            return f"No web results found for '{query}'."
        lines = [f"Web search results for '{query}' (SearXNG):"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r.get('title','(no title)')}\n   {r.get('url','')}\n   {(r.get('content') or '').strip()}")
        return "\n".join(lines)

    return _safe_call(f"search the web for '{query}'", run)


@tool
def web_fetch_page(url: str, max_chars: int = 4000) -> str:
    """Fetches one specific web page and returns its readable text (scripts/styles
    stripped), truncated to max_chars. Provide a full http(s) URL."""
    if not url or not re.match(r"^https?://", url.strip(), re.IGNORECASE):
        return "Please provide a full http:// or https:// URL."
    limit = max(500, min(int(max_chars or 4000), _MAX_PAGE_CHARS))
    url = url.strip()

    def run():
        resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
        ct = resp.headers.get("Content-Type", "")
        if "html" not in ct and "text" not in ct:
            return f"'{url}' is not a readable page (Content-Type: {ct})."
        soup = BeautifulSoup(resp.text, "html.parser")
        title = _page_title(soup, url)
        text = _clean_text(soup)
        if not text:
            return f"'{url}' loaded but had no readable text."
        return f"Content of '{title}' ({url}):\n\n{text[:limit]}{'... [truncated]' if len(text) > limit else ''}"

    return _safe_call(f"fetch '{url}'", run)


@tool
def web_crawl(start_url: str, max_pages: int = 5, same_domain_only: bool = True) -> str:
    """Crawls outward from start_url, following links to gather info from several
    related pages. Fetches up to max_pages total, respects robots.txt. For a
    single known page use web_fetch_page instead."""
    if not start_url or not re.match(r"^https?://", start_url.strip(), re.IGNORECASE):
        return "Please provide a full http:// or https:// starting URL."
    start_url = start_url.strip()
    n = max(1, min(int(max_pages or 5), _MAX_CRAWL_PAGES))

    def run():
        start_domain = urlparse(start_url).netloc
        visited, queue, pages_out = set(), [start_url], []
        while queue and len(visited) < n:
            url = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)
            if not _allowed_by_robots(url):
                pages_out.append(f"--- {url} ---\n[Skipped: robots.txt]")
                continue
            try:
                resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
                resp.raise_for_status()
            except requests.exceptions.RequestException as exc:
                pages_out.append(f"--- {url} ---\n[Error: {exc}]")
                continue
            ct = resp.headers.get("Content-Type", "")
            if "html" not in ct:
                pages_out.append(f"--- {url} ---\n[Skipped: not HTML]")
                continue
            soup = BeautifulSoup(resp.text, "html.parser")
            if len(visited) < n:
                for a in soup.find_all("a", href=True):
                    link = urljoin(url, a["href"]).split("#")[0]
                    if not link.startswith("http"):
                        continue
                    if same_domain_only and urlparse(link).netloc != start_domain:
                        continue
                    if link not in visited and link not in queue:
                        queue.append(link)
            title = _page_title(soup, url)
            text = _clean_text(soup)
            snippet = text[:_CRAWL_PAGE_CHARS] + ("\n... [truncated]" if len(text) > _CRAWL_PAGE_CHARS else "")
            pages_out.append(f"--- {title} ({url}) ---\n{snippet or '[no readable text]'}")
            time.sleep(0.3)
        if not pages_out:
            return f"Could not gather any content from '{start_url}'."
        return (
            f"Crawled {len(visited)} page(s) from '{start_url}':\n\n"
            + "\n\n".join(pages_out)
            + "\n\nIMPORTANT: If using this crawled data to create records in ERPNext, present the proposed details to the user and obtain their explicit confirmation before creating any record."
        )

    return _safe_call(f"crawl '{start_url}'", run)


def _legacy_web_company_search(name: str, hint: str) -> str:
    """Original Tavily/SearXNG-based candidate lookup. Kept as a fallback
    for when the multi-signal resolver (company_crawler.resolver) comes
    back empty -- e.g. DuckDuckGo rate-limited and Tavily/SearXNG still
    work, or vice versa."""
    query = f"{name} {hint} official website".strip()

    search_results = []
    if _tavily_client:
        try:
            resp = _tavily_client.search(query=query, max_results=7, search_depth="basic")
            search_results = resp.get("results", [])
        except Exception:
            pass

    if not search_results:
        try:
            resp = requests.get(f"{_SEARXNG_URL}/search",
                params={"q": query, "format": "json"}, timeout=_REQUEST_TIMEOUT)
            resp.raise_for_status()
            search_results = resp.json().get("results", [])[:7]
        except Exception:
            return ""

    if not search_results:
        return ""

    lines = [f"Top candidate websites for '{name}' (fallback search):"]
    found_any = False
    for i, r in enumerate(search_results, 1):
        url = r.get("url", "")
        if _is_non_official_host(urlparse(url).netloc):
            continue
        found_any = True
        lines.append(f"{i}. {r.get('title', '')}\n   URL: {url}\n   {r.get('content', '')[:150]}...")

    if not found_any:
        return ""

    lines.append(
        "\n--- WAITING FOR USER SELECTION ---\n"
        "Present the above candidates to the user exactly as shown. Then STOP and wait.\n"
        "Ask the user:\n"
        "  'Please choose a website to extract contact details from:\n"
        "   - Reply with 1, 2, or 3 to select a candidate above.\n"
        "   - Or type a URL directly if you know the correct website.\n"
        "   - Or say \"none\" to skip web enrichment and create the lead manually.'\n"
        "Once the user replies with a choice or URL, call `web_company_extract` with that confirmed URL."
    )
    return "\n".join(lines)


@tool
def web_company_search(company_name: str, search_hint: Optional[str] = None) -> str:
    """Find candidate websites for a company, ranked by confidence.
    Uses multi-signal scoring (name/domain similarity, known-directory
    penalties, live title/meta verification, country-TLD match) to rank
    candidates -- falls back to a simpler Tavily/SearXNG search if that
    turns up nothing.
    You MUST present the top options to the user to confirm the correct one.
    Do NOT guess. If they all seem wrong, ask the user for an industry or region hint to refine the search.
    """
    name = (company_name or "").strip()
    if not name:
        return "Please provide a company name to look up."

    hint = (search_hint or "").strip()
    # country_hint is meant for short region codes ("IN", "US", "UK");
    # anything longer is treated as a free-text hint for the legacy path only.
    country_hint = hint if hint and len(hint) <= 3 else None

    try:
        candidates = resolve_company_website(name, country_hint=country_hint, max_candidates=3)
    except Exception as exc:
        logger.warning("company_crawler resolver failed (%s) — falling back to legacy search.", exc)
        candidates = []

    if candidates:
        lines = [f"Top candidate websites for '{name}':"]
        for i, c in enumerate(candidates, 1):
            lines.append(
                f"{i}. {c.domain}  (confidence: {c.score:.0%})\n"
                f"   URL: {c.url}\n"
                f"   title: {c.title or '(none)'}\n"
                f"   why: {'; '.join(c.reasons)}"
            )
        lines.append(
            "\n--- WAITING FOR USER SELECTION ---\n"
            "Present the above candidates to the user exactly as shown. Then STOP and wait.\n"
            "Ask the user:\n"
            "  'Please choose a website to extract contact details from:\n"
            "   - Reply with 1, 2, or 3 to select a candidate above.\n"
            "   - Or type a URL directly if you know the correct website.\n"
            "   - Or say \"none\" to skip web enrichment and create the lead manually.'\n"
            "Once the user replies with a choice or URL, call `web_company_extract` with that confirmed URL."
        )
        return "\n".join(lines)

    # Resolver found nothing (or errored) — try the legacy search path.
    fallback = _legacy_web_company_search(name, hint)
    if fallback:
        return fallback

    return f"No websites found for '{name}'."



@tool
def web_company_extract(url: str, person_name: Optional[str] = None, company_name: Optional[str] = None) -> str:
    """Scrape contact details (email, phone, address, description) from an
    officially confirmed website URL. Uses schema.org structured data,
    mailto:/tel: links, Cloudflare-obfuscated emails, and text-pattern
    matching across homepage, footer links, and contact pages.
    If email or address is not found on the official site, automatically
    falls back to ZaubaCorp (MCA India database) in the background to retrieve
    registered contact details.
    Evaluates whether personal contact details exist for `person_name` or if
    generic corporate fallback data is used.
    Call this ONLY after the user has confirmed the correct company URL
    from `web_company_search`.
    """
    url = (url or "").strip()
    if not url:
        return "Please provide a website URL to extract from."

    if not url.startswith("http://") and not url.startswith("https://"):
        url = f"https://{url}"

    target_person = (person_name or "").strip() or None

    try:
        company_domain = urlparse(url).netloc.lower()
        if company_domain.startswith("www."):
            company_domain = company_domain[4:]

        all_emails, all_phones, all_addresses = [], [], []
        person_emails, person_phones = [], []
        structured_addresses = []
        description = ""
        site_title = ""
        source = "html"
        is_fallback = False
        fallback_fields = []
        direct_person_found = False
        fallback_notice = None

        # 1. Fetch homepage FIRST — single network request
        homepage_html, _method = get_page_html(url)
        if homepage_html:
            hp_res = extract_contact_info(
                homepage_html,
                target_person=target_person,
                company_domain=company_domain,
            )
            all_emails += hp_res.emails
            all_phones += hp_res.phones
            all_addresses += hp_res.addresses
            if hp_res.person_email and hp_res.person_email not in person_emails:
                person_emails.append(hp_res.person_email)
            if hp_res.person_phone and hp_res.person_phone not in person_phones:
                person_phones.append(hp_res.person_phone)
            if hp_res.parsed_address:
                structured_addresses.append(hp_res.parsed_address)
            if hp_res.direct_person_found:
                direct_person_found = True
            if hp_res.source != "html":
                source = hp_res.source

            soup = BeautifulSoup(homepage_html, "lxml")
            if not site_title and soup.title and soup.title.string:
                site_title = soup.title.string.strip()

            if not description:
                meta = (
                    soup.find("meta", attrs={"name": "description"})
                    or soup.find("meta", attrs={"property": "og:description"})
                    or soup.find("meta", attrs={"name": "twitter:description"})
                )
                if meta and meta.get("content"):
                    description = meta["content"].strip()[:300]

        # 2. Early-exit check: if homepage already has verified contact details, skip subpages
        hp_domain_emails = filter_emails_to_domain(all_emails, company_domain) or all_emails
        hp_email = pick_primary_email(hp_domain_emails)
        hp_phone = pick_primary_phone(all_phones)
        hp_address = pick_primary_address(all_addresses) or (structured_addresses[0] if structured_addresses else None)
        hp_person_satisfied = bool(person_emails or person_phones) if target_person else True

        need_subpages = not (hp_email and hp_phone and hp_address and hp_person_satisfied)

        if need_subpages:
            # Reuses pre-fetched homepage_html with 0 extra network calls to discover candidate pages
            contact_candidates = find_contact_pages(url, max_pages=3, homepage_html=homepage_html) or []
            subpage_urls = []
            seen_urls = {url.rstrip("/")}
            for cp in contact_candidates:
                clean_cp = cp["url"].rstrip("/")
                if clean_cp not in seen_urls:
                    seen_urls.add(clean_cp)
                    subpage_urls.append(cp["url"])

            if subpage_urls:
                def _scrape_page(page_url: str):
                    try:
                        p_html, _m = get_page_html(page_url)
                        if not p_html:
                            return None
                        res = extract_contact_info(
                            p_html,
                            target_person=target_person,
                            company_domain=company_domain,
                        )
                        p_desc = ""
                        p_soup = BeautifulSoup(p_html, "lxml")
                        p_meta = (
                            p_soup.find("meta", attrs={"name": "description"})
                            or p_soup.find("meta", attrs={"property": "og:description"})
                            or p_soup.find("meta", attrs={"name": "twitter:description"})
                        )
                        if p_meta and p_meta.get("content"):
                            p_desc = p_meta["content"].strip()[:300]
                        return res, p_desc
                    except Exception:
                        return None

                with concurrent.futures.ThreadPoolExecutor(max_workers=min(3, len(subpage_urls))) as executor:
                    futures = [executor.submit(_scrape_page, p_url) for p_url in subpage_urls[:3]]
                    for f in concurrent.futures.as_completed(futures):
                        out = f.result()
                        if not out:
                            continue
                        sub_res, sub_desc = out
                        all_emails += sub_res.emails
                        all_phones += sub_res.phones
                        all_addresses += sub_res.addresses
                        if sub_res.person_email and sub_res.person_email not in person_emails:
                            person_emails.append(sub_res.person_email)
                        if sub_res.person_phone and sub_res.person_phone not in person_phones:
                            person_phones.append(sub_res.person_phone)
                        if sub_res.parsed_address:
                            structured_addresses.append(sub_res.parsed_address)
                        if sub_res.direct_person_found:
                            direct_person_found = True
                        if sub_res.source != "html":
                            source = sub_res.source
                        if not description and sub_desc:
                            description = sub_desc

        domain_emails = filter_emails_to_domain(all_emails, company_domain) or all_emails

        company_email = pick_primary_email(domain_emails) or pick_primary_email(all_emails)
        company_phone = pick_primary_phone(all_phones)
        primary_address = pick_primary_address(all_addresses)

        # Resolve primary structured address from website
        parsed_addr = structured_addresses[0] if structured_addresses else {}
        if not parsed_addr and primary_address:
            from .company_crawler.extractor import parse_address_fields
            parsed_addr = parse_address_fields(primary_address).as_dict()

        # Autonomous ZaubaCorp Fallback if email or address is missing
        zauba_data = None
        zauba_email_used = False
        zauba_address_used = False

        if not company_email or not primary_address:
            # Determine effective company name to query
            effective_company_name = (company_name or "").strip()
            if not effective_company_name:
                if site_title:
                    # Clean title: e.g. "Tata Motors - Official Website" -> "Tata Motors"
                    effective_company_name = re.split(r"[-|:–—]", site_title)[0].strip()
                if not effective_company_name:
                    clean_host = company_domain.split(".")[0].replace("-", " ").replace("_", " ").title()
                    effective_company_name = clean_host

            logger.info("Email or address missing on %s — initiating ZaubaCorp fallback for '%s'...", url, effective_company_name)
            try:
                zauba_data = lookup_zaubacorp_fallback(effective_company_name, domain=company_domain)
                if zauba_data:
                    if not company_email and zauba_data.email:
                        company_email = zauba_data.email
                        zauba_email_used = True
                    if not primary_address and zauba_data.address:
                        primary_address = zauba_data.address
                        parsed_addr = zauba_data.parsed_address or (parse_address_fields(primary_address).as_dict() if primary_address else {})
                        zauba_address_used = True

                    if zauba_email_used or zauba_address_used:
                        source = f"{source} + zaubacorp fallback"
            except Exception as z_err:
                logger.warning("ZaubaCorp fallback failed for '%s': %s", effective_company_name, z_err)

        if target_person:
            # Condition 1: Person name provided
            from .company_crawler.extractor import find_person_email
            matched_person_email = person_emails[0] if person_emails else (find_person_email(target_person, domain_emails) or find_person_email(target_person, all_emails))
            matched_person_phone = person_phones[0] if person_phones else None

            if matched_person_email or matched_person_phone:
                direct_person_found = True
                primary_email = matched_person_email or company_email
                primary_phone = matched_person_phone or company_phone
                is_fallback = False
            else:
                direct_person_found = False
                primary_email = company_email
                primary_phone = company_phone
                is_fallback = True
                fallback_fields = []
                if primary_email:
                    fallback_fields.append("email")
                if primary_phone:
                    fallback_fields.append("phone")
                if primary_address or parsed_addr:
                    fallback_fields.append("address")
                fallback_notice = (
                    f"Note: I couldn't find the lead person's information ({target_person}) on {url}, "
                    f"so using company's contact information ({primary_email or 'no email'} / {primary_phone or 'no phone'})."
                )
        else:
            # Condition 2: No person name provided, directly use company info
            primary_email = company_email
            primary_phone = company_phone
            direct_person_found = False
            is_fallback = False
            fallback_fields = []
            fallback_notice = None

        if primary_email or primary_phone or primary_address or description:
            zauba_notice = ""
            if zauba_data and (zauba_email_used or zauba_address_used):
                zauba_notice = (
                    "\n⚠  Email or address was not found on the official website.\n"
                    "   Falling back to ZaubaCorp (MCA public registry) for missing fields.\n"
                )

            # Build formatted review table
            def _field(label: str, value: str, source_tag: str = "") -> str:
                val = value if value else "Not found"
                tag = f"  {source_tag}" if source_tag else ""
                return f"| {label:<18} | {val}{tag} |"

            email_tag = "(MCA registry)" if zauba_email_used else ""
            address_tag = "(MCA registry)" if zauba_address_used else ""

            addr_line1 = parsed_addr.get("address_line1", "") if parsed_addr else ""
            city_val = parsed_addr.get("city", "") if parsed_addr else ""
            state_val = parsed_addr.get("state", "") if parsed_addr else ""
            pincode_val = parsed_addr.get("pincode", "") if parsed_addr else ""
            country_val = parsed_addr.get("country", "") if parsed_addr else ""

            table_rows = [
                "| Field              | Value                           |",
                "|--------------------|----------------------------------|",
                _field("Email", primary_email or "", email_tag),
                _field("Phone", primary_phone or ""),
                _field("Address", primary_address or "", address_tag),
            ]
            if addr_line1:
                table_rows.append(_field("Address Line 1", addr_line1))
            if city_val:
                table_rows.append(_field("City", city_val))
            if state_val:
                table_rows.append(_field("State", state_val))
            if pincode_val:
                table_rows.append(_field("Pincode", pincode_val))
            if country_val:
                table_rows.append(_field("Country", country_val))
            if description:
                table_rows.append(_field("Description", description[:120] + ("..." if len(description) > 120 else "")))
            if zauba_data and zauba_data.cin:
                table_rows.append(_field("CIN", zauba_data.cin, "(MCA registry)"))
            if zauba_data and zauba_data.directors:
                table_rows.append(_field("Directors", ", ".join(zauba_data.directors[:3]), "(MCA registry)"))

            person_block = ""
            if target_person:
                person_status = "✓ Found directly" if direct_person_found else "✗ Not found — using company contact"
                person_block = (
                    f"\n👤 Person: **{target_person}** — {person_status}\n"
                )
                if is_fallback and fallback_notice:
                    person_block += f"   ⚠  {fallback_notice}\n"

            lines = [
                f"--- EXTRACTION COMPLETE ---",
                f"Source: {url} (via {source}){zauba_notice}",
                "",
                *table_rows,
                person_block,
                "\n--- ACTION REQUIRED ---",
                "Present the above details to the user in a clear table. Then STOP and wait.",
                "Ask: 'Do all these details look correct? Tell me if you want to change any field, or say \"proceed\" to create the lead.'",
                "Wait for user confirmation or corrections before calling erp_data_tool.",
                "If the user approves, call erp_data_tool(operation='create', web_enriched=True, approved=True) with ALL available fields.",
            ]
            return "\n".join(lines)

    except Exception as exc:
        logger.warning("company_crawler extractor failed for '%s' (%s) — no contact details found.", url, exc)

    return f"Could not extract any contact details from {url}."



WEB_TOOLS = [web_search, web_fetch_page, web_crawl, web_company_search, web_company_extract]

