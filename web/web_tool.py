"""
MagmaAssistance/web/web_tool.py

Public web tools. Company enrichment is delegated to company_resolver.py,
which uses Google Search for discovery (DDGS fallback) and Crawl4AI/Playwright
for JavaScript-capable rendering and evidence extraction.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional
from urllib.parse import urljoin, urlparse
import urllib.robotparser as robotparser

import requests
from bs4 import BeautifulSoup
from langchain_core.tools import tool

from .company_resolver import resolve_company

logger = logging.getLogger("web-tools")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36 MagmaAssistant/2.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
_REQUEST_TIMEOUT = 15
_MAX_SEARCH_RESULTS = 8
_MAX_PAGE_CHARS = 8000
_MAX_CRAWL_PAGES = 10
_CRAWL_PAGE_CHARS = 3000


def _safe_call(action: str, fn):
    try:
        return fn()
    except requests.exceptions.Timeout:
        return f"Timed out while trying to {action}. The site may be slow or unreachable."
    except requests.exceptions.RequestException as exc:
        return f"Could not {action}: {exc}"
    except Exception as exc:
        logger.exception("web tool failed: %s", action)
        return f"Could not {action}: {exc}"


def _clean_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "form"]):
        tag.decompose()
    lines = [line.strip() for line in soup.get_text(separator="\n").splitlines()]
    return "\n".join(line for line in lines if line)


def _page_title(soup: BeautifulSoup, fallback: str) -> str:
    return soup.title.get_text(strip=True) if soup.title else fallback


def _allowed_by_robots(url: str) -> bool:
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
    """Search the public internet for current information. Returns titles, URLs and snippets."""
    n = max(1, min(int(max_results or 5), _MAX_SEARCH_RESULTS))

    def run():
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=n))
        if not results:
            return f"No web results found for '{query}'."
        lines = [f"Web search results for '{query}':"]
        for i, r in enumerate(results, 1):
            lines.append(
                f"{i}. {r.get('title', '(no title)')}\n"
                f"   {r.get('href') or r.get('link') or ''}\n"
                f"   {(r.get('body') or '').strip()}"
            )
        return "\n".join(lines)

    return _safe_call(f"search the web for '{query}'", run)


@tool
def web_fetch_page(url: str, max_chars: int = 4000) -> str:
    """Fetch one HTTP(S) page and return cleaned readable text."""
    if not url or not re.match(r"^https?://", url.strip(), re.I):
        return "Please provide a full http:// or https:// URL to fetch."
    limit = max(500, min(int(max_chars or 4000), _MAX_PAGE_CHARS))
    url = url.strip()

    def run():
        resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if "html" not in content_type and "text" not in content_type:
            return f"'{url}' is not a readable HTML/text page (Content-Type: {content_type})."
        soup = BeautifulSoup(resp.text, "lxml")
        text = _clean_text(soup)
        if not text:
            return f"'{url}' loaded but no readable text was found."
        suffix = "" if len(text) <= limit else "\n... [truncated]"
        return f"Content of '{_page_title(soup, url)}' ({url}):\n\n{text[:limit]}{suffix}"

    return _safe_call(f"fetch '{url}'", run)


@tool
def web_crawl(start_url: str, max_pages: int = 5, same_domain_only: bool = True) -> str:
    """Crawl several HTML pages from a starting URL using the legacy lightweight crawler."""
    if not start_url or not re.match(r"^https?://", start_url.strip(), re.I):
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
            if "html" not in resp.headers.get("Content-Type", ""):
                continue
            soup = BeautifulSoup(resp.text, "lxml")
            for a in soup.find_all("a", href=True):
                link = urljoin(url, a["href"]).split("#")[0]
                if not link.startswith("http"):
                    continue
                if same_domain_only and urlparse(link).netloc != start_domain:
                    continue
                if link not in visited and link not in queue:
                    queue.append(link)
            text = _clean_text(soup)
            snippet = text[:_CRAWL_PAGE_CHARS]
            if len(text) > _CRAWL_PAGE_CHARS:
                snippet += "\n... [truncated]"
            pages_out.append(f"--- {_page_title(soup, url)} ({url}) ---\n{snippet}")
        if not pages_out:
            return f"Could not gather any content starting from '{start_url}'."
        return f"Crawled {len(visited)} page(s):\n\n" + "\n\n".join(pages_out)

    return _safe_call(f"crawl starting from '{start_url}'", run)


@tool
def web_company_lookup(
    company_name: str,
    selected_website: Optional[str] = None,
    search_hint: Optional[str] = None,
    selected_company_cin: Optional[str] = None,
):
    """
    Identify a company and retrieve its public contact information.

    IMPORTANT THREE-STAGE PROCESS:

    FIRST CALL:
        Provide only company_name.

        Example:
            web_company_lookup(
                company_name="Magna Data Pvt Ltd"
            )

        When configured, this first returns up to three matching legal entities
        from MCA master data (data.gov.in). The user must select a legal entity.
        If MCA data is unavailable or has no match, it returns website candidates
        from Google Places, then Google Search, then DDGS.

        It DOES NOT crawl websites.

        It returns a list of possible companies and asks the
        user which company they mean.

    SECOND CALL (only after an MCA result):
        After the user chooses a legal entity, pass its CIN. This returns website
        candidates and does not crawl yet.

        web_company_lookup(
            company_name="Magna Data Pvt Ltd",
            selected_company_cin="U12345MH2020PTC123456"
        )

    FINAL CALL:
        After the user chooses a website, pass selected_website.

        Example:
            web_company_lookup(
                company_name="Magna Data Pvt Ltd",
                selected_website="https://example.com"
            )

        This crawls ONLY the selected website.

    Alternatively, if the user provides identifying information
    such as city/country:

        web_company_lookup(
            company_name="Magna Data Pvt Ltd",
            search_hint="Pune Maharashtra"
        )

        This performs one targeted search and asks the user to select
        the website to crawl.

    NEVER invent a company identity.
    NEVER crawl multiple companies after the user has selected one.
    NEVER treat LinkedIn, IndiaMART, Justdial, Wikipedia, etc.
    as the official company website.
    """

    result = resolve_company(
        company_name=company_name,
        selected_website=selected_website,
        search_hint=search_hint,
        selected_company_cin=selected_company_cin,
    )

    return result.to_dict()


WEB_TOOLS = [web_search, web_fetch_page, web_crawl, web_company_lookup]
