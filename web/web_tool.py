"""
web/web_tool.py

Generic internet-access tools for the agent, following the same
LangChain `@tool` + plain-string-error pattern used by
ERP_Unified/tools.py (see `_safe_call` there). These are NOT tied to
ERPNext -- they let the agent look things up on the open internet when
the answer isn't in the ERP system.

Four tools are exposed:

  - web_search        : Tavily AI-optimized search (primary), falls
                        back to local SearXNG if Tavily is unavailable.
  - web_fetch_page     : fetch one URL and return its readable text.
  - web_crawl         : fetch a start URL, follow its links (same-domain
                        by default) and gather text from several pages
                        in one call -- the actual "crawler".
  - web_company_lookup : find a named company's official site and pull
                        out its public email/phone/description via
                        mailto:/tel: links -- built specifically to help
                        pre-fill ERP records (Lead, Customer, etc.) when
                        the user only gives a company name.

Requirements (see requirements.txt):
    pip install tavily-python beautifulsoup4 lxml

Set TAVILY_API_KEY in your .env file to enable Tavily search.
If not set, falls back to local SearXNG at http://localhost:8080.
"""

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

load_dotenv()

logger = logging.getLogger("web-tools")

# ---------------------------------------------------------------------------
# Tavily client (primary search engine)
# ---------------------------------------------------------------------------
_TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
_tavily_client = None
if _TAVILY_API_KEY:
    try:
        from tavily import TavilyClient
        _tavily_client = TavilyClient(api_key=_TAVILY_API_KEY)
        logger.info("Tavily search client initialized (primary search engine).")
    except Exception as _e:
        logger.warning("Tavily import failed (%s) — falling back to SearXNG.", _e)
else:
    logger.info("TAVILY_API_KEY not set — using SearXNG as primary search engine.")

# SearXNG fallback URL
_SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")


_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 MagmaAssistant/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_REQUEST_TIMEOUT = 12       # seconds, per HTTP request
_MAX_SEARCH_RESULTS = 8     # hard ceiling regardless of what's requested
_MAX_PAGE_CHARS = 8000      # hard ceiling on text returned for one page
_MAX_CRAWL_PAGES = 10       # hard ceiling on pages per web_crawl call
_CRAWL_PAGE_CHARS = 2000    # per-page text budget when crawling several


def _safe_call(action: str, fn):
    """Never let a raw exception/stack trace reach the LLM -- turn it
    into one plain sentence the agent can relay to the user. Mirrors
    ERP_Unified.dynamic_fields.safe_call so tool-call failures look and
    behave the same across the whole app."""
    try:
        return fn()
    except requests.exceptions.Timeout:
        return f"Timed out while trying to {action}. The site may be slow or unreachable."
    except requests.exceptions.RequestException as exc:
        return f"Could not {action}: {exc}"
    except Exception as exc:  # noqa: BLE001
        logger.exception("web tool failed: %s", action)
        return f"Could not {action}: {exc}"


def _clean_text(soup: BeautifulSoup) -> str:
    """Strips script/style/nav/footer noise and collapses the rest into
    readable, non-blank lines."""
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "form"]):
        tag.decompose()
    lines = [line.strip() for line in soup.get_text(separator="\n").splitlines()]
    return "\n".join(line for line in lines if line)


def _page_title(soup: BeautifulSoup, fallback: str) -> str:
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    return fallback


def _allowed_by_robots(url: str) -> bool:
    """Best-effort robots.txt check. Fails open (treats the page as
    allowed) if robots.txt can't be fetched/parsed -- most sites don't
    have one, and that matches normal browser behavior."""
    try:
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = robotparser.RobotFileParser()
        rp.set_url(robots_url)
        rp.read()
        return rp.can_fetch(_HEADERS["User-Agent"], url)
    except Exception:
        return True


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """Searches the public internet for up-to-date information that isn't
    in the ERP system -- news, product specs, general knowledge, current
    events, company/person lookups, documentation, etc.

    Uses Tavily (AI-optimized search) as the primary engine when
    TAVILY_API_KEY is set; falls back to the local SearXNG instance
    automatically.

    Returns a numbered list of results with title, URL, and snippet.
    Call web_fetch_page on a specific URL afterwards if you need the
    full page content. Keep `query` short and specific."""

    n = max(1, min(int(max_results or 5), _MAX_SEARCH_RESULTS))

    def run():
        # ── Primary: Tavily ──────────────────────────────────────────────
        if _tavily_client:
            try:
                resp = _tavily_client.search(
                    query=query,
                    max_results=n,
                    include_answer=True,          # Tavily synthesizes a direct answer
                    include_raw_content=False,
                    search_depth="advanced",      # deeper crawl for better coverage
                )
                results = resp.get("results", [])
                answer = resp.get("answer", "")

                if not results:
                    return f"No web results found for '{query}'."

                lines = [f"Web search results for '{query}':"]
                if answer:
                    lines.append(f"\n📋 Direct answer: {answer}\n")
                for i, r in enumerate(results, start=1):
                    title = r.get("title", "(no title)")
                    url = r.get("url") or ""
                    snippet = (r.get("content") or "").strip()[:400]
                    score = r.get("score", 0)
                    lines.append(f"{i}. {title}\n   {url}\n   {snippet}")
                return "\n".join(lines)
            except Exception as exc:
                logger.warning("Tavily search failed (%s) — falling back to SearXNG.", exc)

        # ── Fallback: SearXNG ────────────────────────────────────────────
        try:
            resp = requests.get(
                f"{_SEARXNG_URL}/search",
                params={"q": query, "format": "json"},
                timeout=_REQUEST_TIMEOUT
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])[:n]
        except Exception as exc:
            logger.error("SearXNG web_search also failed: %s", exc)
            return f"Web search is temporarily unavailable. Could not search for '{query}'."

        if not results:
            return f"No web results found for '{query}'."

        lines = [f"Web search results for '{query}' (via SearXNG):"]
        for i, r in enumerate(results, start=1):
            title = r.get("title", "(no title)")
            url = r.get("url") or ""
            snippet = (r.get("content") or "").strip()
            lines.append(f"{i}. {title}\n   {url}\n   {snippet}")
        return "\n".join(lines)

    return _safe_call(f"search the web for '{query}'", run)



@tool
def web_fetch_page(url: str, max_chars: int = 4000) -> str:
    """Fetches one specific web page by URL and returns its readable
    text content (scripts/styles/nav/footer stripped out), truncated to
    `max_chars`. Use this after web_search to read a promising result in
    full, or any time the user gives you a direct URL. `url` must be a
    complete http(s) address."""

    if not url or not re.match(r"^https?://", url.strip(), re.IGNORECASE):
        return "Please provide a full http:// or https:// URL to fetch."

    limit = max(500, min(int(max_chars or 4000), _MAX_PAGE_CHARS))
    url = url.strip()

    def run():
        resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()

        content_type = resp.headers.get("Content-Type", "")
        if "html" not in content_type and "text" not in content_type:
            return f"'{url}' does not look like a readable web page (Content-Type: {content_type})."

        soup = BeautifulSoup(resp.text, "html.parser")
        title = _page_title(soup, url)
        text = _clean_text(soup)

        if not text:
            return f"'{url}' loaded but no readable text was found on the page."

        truncated = text[:limit]
        suffix = "" if len(text) <= limit else "\n... [truncated]"
        return f"Content of '{title}' ({url}):\n\n{truncated}{suffix}"

    return _safe_call(f"fetch '{url}'", run)


@tool
def web_crawl(start_url: str, max_pages: int = 5, same_domain_only: bool = True) -> str:
    """Crawls outward from `start_url`, following links on each page to
    gather information from several related pages in ONE call -- e.g.
    'read through this site's docs and summarize X' or 'crawl this
    company's website for contact info'. Fetches up to `max_pages` pages
    total (including the start page), respects each site's robots.txt,
    and returns the readable text of every page it visited, truncated
    per page. For a single already-known page, use web_fetch_page
    instead -- it's cheaper and returns more text for that one page. Set
    `same_domain_only=False` to allow following links off the starting
    site (use sparingly -- this can wander off-topic fast)."""

    if not start_url or not re.match(r"^https?://", start_url.strip(), re.IGNORECASE):
        return "Please provide a full http:// or https:// starting URL to crawl."

    start_url = start_url.strip()
    n = max(1, min(int(max_pages or 5), _MAX_CRAWL_PAGES))

    def run():
        start_domain = urlparse(start_url).netloc
        visited: set[str] = set()
        queue = [start_url]
        pages_out = []

        while queue and len(visited) < n:
            url = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)

            if not _allowed_by_robots(url):
                pages_out.append(f"--- {url} ---\n[Skipped: disallowed by robots.txt]")
                continue

            try:
                resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
                resp.raise_for_status()
            except requests.exceptions.RequestException as exc:
                pages_out.append(f"--- {url} ---\n[Could not fetch: {exc}]")
                continue

            content_type = resp.headers.get("Content-Type", "")
            if "html" not in content_type:
                pages_out.append(f"--- {url} ---\n[Skipped: not an HTML page ({content_type})]")
                continue

            soup = BeautifulSoup(resp.text, "html.parser")

            # Queue up links found on THIS page (before tag-stripping)
            # so the next hop follows real navigation, not leftover text.
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
            snippet = text[:_CRAWL_PAGE_CHARS]
            if len(text) > _CRAWL_PAGE_CHARS:
                snippet += "\n... [truncated]"
            pages_out.append(f"--- {title} ({url}) ---\n{snippet or '[no readable text]'}")

            time.sleep(0.3)  # light politeness delay between requests

        if not pages_out:
            return f"Could not gather any content starting from '{start_url}'."

        return (
            f"Crawled {len(visited)} page(s) starting from '{start_url}':\n\n"
            + "\n\n".join(pages_out)
        )

    return _safe_call(f"crawl starting from '{start_url}'", run)


_GENERIC_EMAIL_PREFIXES = {"noreply", "no-reply", "donotreply", "webmaster", "postmaster", "abuse"}
_LOOKUP_CANDIDATE_PAGES = 5  # how many search-result sites to try before giving up

# Directories/social/news/reference sites that show up high for almost
# any company search but are never the company's own site -- excluded
# outright so they can't get picked as the "official" URL (this is what
# caused Wikipedia to get treated as Infosys's official site).
_NON_OFFICIAL_HOSTS = {
    "wikipedia.org", "wikimedia.org", "linkedin.com", "facebook.com",
    "twitter.com", "x.com", "instagram.com", "youtube.com",
    "crunchbase.com", "bloomberg.com", "reuters.com", "indiamart.com",
    "glassdoor.com", "glassdoor.co.in", "zoominfo.com", "owler.com",
    "craft.co", "medium.com", "quora.com", "reddit.com", "yelp.com",
    "tradeindia.com", "justdial.com", "opencorporates.com", "dnb.com",
    "google.com", "bing.com", "duckduckgo.com", "britannica.com",
    "forbes.com", "investopedia.com", "wsj.com",
}

# Link text/href fragments worth following one extra hop to look for
# contact details when the homepage itself has no mailto:/tel: links
# (very common -- most corporate homepages route contact through a form).
_CONTACT_LINK_HINTS = ("contact", "reach us", "get in touch", "contact-us", "contactus")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _registrable_domain(netloc: str) -> str:
    """Best-effort second-level domain, e.g. 'www.infosys.com' -> 'infosys'."""
    host = netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    parts = host.split(".")
    return parts[-2] if len(parts) >= 2 else host


def _is_non_official_host(netloc: str) -> bool:
    host = netloc.lower()
    return any(host == h or host.endswith("." + h) for h in _NON_OFFICIAL_HOSTS)


def _extract_contacts(soup: BeautifulSoup) -> tuple[list, list]:
    emails, phones = [], []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            addr = href.split(":", 1)[1].split("?")[0].strip()
            local = addr.split("@")[0].lower()
            if addr and addr not in emails and local not in _GENERIC_EMAIL_PREFIXES:
                emails.append(addr)
        elif href.lower().startswith("tel:"):
            num = href.split(":", 1)[1].strip()
            if num and num not in phones:
                phones.append(num)
    return emails, phones


def _find_contact_page_link(soup: BeautifulSoup, base_url: str) -> Optional[str]:
    for a in soup.find_all("a", href=True):
        label = (a.get_text() or "").strip().lower()
        href = a["href"].lower()
        if any(hint in label or hint in href for hint in _CONTACT_LINK_HINTS):
            link = urljoin(base_url, a["href"])
            if link.startswith("http"):
                return link
    return None


@tool
def web_company_search(company_name: str, search_hint: Optional[str] = None) -> str:
    """Find candidate websites for a company.
    Uses search to find the official website.
    You MUST present the top options to the user to confirm the correct one.
    Do NOT guess. If they all seem wrong, ask the user for an industry or region hint to refine the search.
    """
    name = (company_name or "").strip()
    if not name:
        return "Please provide a company name to look up."
        
    hint = (search_hint or "").strip()
    query = f"{name} {hint} official website".strip()
    
    search_results = []
    if _tavily_client:
        try:
            resp = _tavily_client.search(query=query, max_results=5, search_depth="basic")
            search_results = resp.get("results", [])
        except Exception:
            pass
            
    if not search_results:
        try:
            resp = requests.get(
                f"{_SEARXNG_URL}/search",
                params={"q": query, "format": "json"},
                timeout=_REQUEST_TIMEOUT
            )
            resp.raise_for_status()
            search_results = resp.json().get("results", [])[:5]
        except Exception:
            return "Web search unavailable."
            
    if not search_results:
        return f"No websites found for '{name}'."
        
    lines = [f"Top candidate websites for '{name}':"]
    for i, r in enumerate(search_results, 1):
        url = r.get("url", "")
        if _is_non_official_host(urlparse(url).netloc):
            continue
        lines.append(f"{i}. {r.get('title', '')}\n   URL: {url}\n   {r.get('content', '')[:150]}...")
        
    lines.append("\nAsk the user to confirm which URL is correct. Once confirmed, use `web_company_extract` on that URL.")
    return "\n".join(lines)

@tool
def web_company_extract(url: str) -> str:
    """Scrape contact details (email, phone, description) from an officially confirmed website URL.
    Call this ONLY after the user has confirmed the correct company URL from `web_company_search`.
    """
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        return f"Could not reach {url}: {e}"
        
    soup = BeautifulSoup(resp.text, "html.parser")
    emails, phones = _extract_contacts(soup)
    
    description = ""
    meta = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    if meta and meta.get("content"):
        description = meta["content"].strip()[:300]
        
    if not emails and not phones:
        contact_url = _find_contact_page_link(soup, url)
        if contact_url:
            try:
                c_resp = requests.get(contact_url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
                c_resp.raise_for_status()
                c_soup = BeautifulSoup(c_resp.text, "html.parser")
                emails, phones = _extract_contacts(c_soup)
            except Exception:
                pass
            if not emails and not phones:
                return f"Website: {url}\nDescription: {description}\nContact details not found on homepage, but a contact form may be at: {contact_url}"
                
    lines = [f"Extracted details from {url}:"]
    lines.append(f"- Email: {emails[0] if emails else 'not found'}")
    lines.append(f"- Phone: {phones[0] if phones else 'not found'}")
    if description:
        lines.append(f"- Description: {description}")
        
    return "\n".join(lines)

WEB_TOOLS = [web_search, web_fetch_page, web_crawl, web_company_search, web_company_extract]
