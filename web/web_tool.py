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
"""

import logging
import re
import time
from typing import Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from langchain_core.tools import tool
import requests

from web.scraper import (
    _allowed_by_robots,
    _clean_text,
    _CONTACT_LINK_HINTS,
    _CRAWL_PAGE_CHARS,
    _EMAIL_RE,
    _extract_contacts_from_soup,
    _extract_description,
    _extract_person_names,
    _fetch_soup,
    _find_subpage_links,
    _GENERIC_EMAIL_PREFIXES,
    _HEADERS,
    _is_non_official_host,
    _MAX_CRAWL_PAGES,
    _MAX_PAGE_CHARS,
    _MAX_SEARCH_RESULTS,
    _NON_OFFICIAL_HOSTS,
    _page_title,
    _PHONE_RE,
    _REQUEST_TIMEOUT,
    _safe_call,
    _SEARXNG_URL,
    _SOCIAL_PATTERNS,
    _tavily_client,
)

logger = logging.getLogger("web-tools")


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
                resp = _tavily_client.search(
                    query=query,
                    max_results=n,
                    include_answer=True,
                    include_raw_content=False,
                    search_depth="advanced",
                )
                results = resp.get("results", [])
                answer = resp.get("answer", "")
                if not results:
                    return f"No web results found for '{query}'."
                lines = [f"Web search results for '{query}':"]
                if answer:
                    lines.append(f"\n📋 Direct answer: {answer}\n")
                for i, r in enumerate(results, 1):
                    lines.append(
                        f"{i}. {r.get('title','(no title)')}\n   {r.get('url','')}\n   {(r.get('content') or '').strip()[:400]}"
                    )
                return "\n".join(lines)
            except Exception as exc:
                logger.warning("Tavily failed (%s) — falling back to SearXNG.", exc)
        try:
            resp = requests.get(
                f"{_SEARXNG_URL}/search",
                params={"q": query, "format": "json"},
                timeout=_REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])[:n]
        except Exception:
            return f"Web search unavailable for '{query}'."
        if not results:
            return f"No web results found for '{query}'."
        lines = [f"Web search results for '{query}' (SearXNG):"]
        for i, r in enumerate(results, 1):
            lines.append(
                f"{i}. {r.get('title','(no title)')}\n   {r.get('url','')}\n   {(r.get('content') or '').strip()}"
            )
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
            snippet = text[:_CRAWL_PAGE_CHARS] + (
                "\n... [truncated]" if len(text) > _CRAWL_PAGE_CHARS else ""
            )
            pages_out.append(f"--- {title} ({url}) ---\n{snippet or '[no readable text]'}")
            time.sleep(0.3)
        if not pages_out:
            return f"Could not gather any content from '{start_url}'."
        return f"Crawled {len(visited)} page(s) from '{start_url}':\n\n" + "\n\n".join(pages_out)

    return _safe_call(f"crawl '{start_url}'", run)


@tool
def web_company_search(company_name: str, search_hint: Optional[str] = None) -> str:
    """Find candidate official websites for a company by name.
    Returns a ranked shortlist (directories/social sites filtered out).
    ALWAYS present options to the user for confirmation before calling web_company_extract.
    Use search_hint to disambiguate (e.g. 'Mumbai', 'software', 'textile')."""
    name = (company_name or "").strip()
    if not name:
        return "Please provide a company name."
    hint = (search_hint or "").strip()
    query = f"{name} {hint} official website".strip()

    results = []
    if _tavily_client:
        try:
            resp = _tavily_client.search(query=query, max_results=7, search_depth="basic")
            results = resp.get("results", [])
        except Exception:
            pass
    if not results:
        try:
            resp = requests.get(
                f"{_SEARXNG_URL}/search",
                params={"q": query, "format": "json"},
                timeout=_REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])[:7]
        except Exception:
            return "Web search unavailable."
    if not results:
        return f"No websites found for '{name}'."

    lines = [f"Top candidate websites for '{name}':"]
    count = 0
    for r in results:
        url = r.get("url", "")
        if _is_non_official_host(urlparse(url).netloc):
            continue
        count += 1
        lines.append(f"{count}. {r.get('title','')}\n   URL: {url}\n   {(r.get('content') or '').strip()[:150]}...")
        if count >= 5:
            break
    if count == 0:
        return f"Only directory/social results found for '{name}'. Add an industry or city hint."
    lines.append("\nConfirm the correct URL with the user, then call `web_company_extract` on it.")
    return "\n".join(lines)


@tool
def web_company_extract(url: str, company_name: Optional[str] = None) -> str:
    """Deep extraction of contact details and company profile from a confirmed website.

    Extracts:
    - Email (mailto: links + plain-text regex scan + JSON-LD schema.org)
    - Phone (tel: links + Indian/international phone regex + JSON-LD)
    - WhatsApp (wa.me links)
    - Social profiles (LinkedIn, Twitter/X, Instagram, YouTube, Facebook)
    - Company description (2-3 sentences: meta tags → JSON-LD → first paragraph)
    - Person/lead names (schema.org Person objects)

    Auto-crawls up to 3 subpages (Contact, About, Team) if homepage yields nothing.
    Call ONLY after user has confirmed the correct URL from web_company_search."""

    url = (url or "").strip()
    if not url or not re.match(r"^https?://", url, re.IGNORECASE):
        return "Please provide a valid http:// or https:// URL."

    def run():
        soup = _fetch_soup(url)
        if not soup:
            return f"Could not reach or parse {url}."

        contacts = _extract_contacts_from_soup(soup)
        description = _extract_description(soup)
        person_names = _extract_person_names(soup)
        pages_tried = [url]

        # Auto-crawl subpages if contacts are incomplete
        if not contacts["emails"] or not contacts["phones"]:
            subpages = _find_subpage_links(soup, url, max_links=5)
            for sub_url in subpages[:3]:
                if sub_url in pages_tried:
                    continue
                pages_tried.append(sub_url)
                sub_soup = _fetch_soup(sub_url)
                if not sub_soup:
                    continue
                sub_contacts = _extract_contacts_from_soup(sub_soup)
                for key in ("emails", "phones", "whatsapp", "addresses"):
                    for val in sub_contacts[key]:
                        if val not in contacts[key]:
                            contacts[key].append(val)
                for platform, link in sub_contacts["socials"].items():
                    if platform not in contacts["socials"]:
                        contacts["socials"][platform] = link
                if not description:
                    description = _extract_description(sub_soup)
                if not person_names:
                    person_names = _extract_person_names(sub_soup)
                if contacts["emails"] and contacts["phones"]:
                    break
                time.sleep(0.3)

        # Fallback: If no email found on the official site, execute a broad web search automatically
        fallback_emails = []
        if not contacts["emails"]:
            search_query = f"{company_name or urlparse(url).netloc.replace('www.', '')} contact email address"
            try:
                if _tavily_client:
                    resp = _tavily_client.search(query=search_query, max_results=10)
                    results = resp.get("results", [])
                else:
                    resp = requests.get(
                        f"{_SEARXNG_URL}/search",
                        params={"q": search_query, "format": "json"},
                        timeout=_REQUEST_TIMEOUT,
                    )
                    results = resp.json().get("results", [])

                combined_text = " ".join([r.get("content", "") + " " + r.get("title", "") for r in results])
                for match in _EMAIL_RE.finditer(combined_text):
                    addr = match.group().lower()
                    local = addr.split("@")[0]
                    if local not in _GENERIC_EMAIL_PREFIXES and addr not in fallback_emails:
                        fallback_emails.append(addr)
            except Exception as e:
                logger.warning(f"Fallback email search failed: {e}")

        lines = [
            f"Contact extraction for: {url}",
            f"Pages scanned: {', '.join(pages_tried)}\n",
        ]

        primary_email = "NOT FOUND"
        if contacts["emails"]:
            primary_email = contacts["emails"][0]
            lines.append(f"Email:       {primary_email}")
            if len(contacts["emails"]) > 1:
                lines.append(f"  (also: {', '.join(contacts['emails'][1:])})")
        elif fallback_emails:
            primary_email = fallback_emails[0]
            lines.append(f"Email:       {primary_email} (found via broad web search)")
            if len(fallback_emails) > 1:
                lines.append(f"  (also: {', '.join(fallback_emails[1:])})")
        else:
            lines.append("Email:       NOT FOUND")

        primary_phone = contacts["phones"][0] if contacts["phones"] else "NOT FOUND"
        lines.append(f"Phone:       {primary_phone}")
        if len(contacts["phones"]) > 1:
            lines.append(f"  (also: {', '.join(contacts['phones'][1:])})")

        if contacts["whatsapp"]:
            lines.append(f"WhatsApp:    {contacts['whatsapp'][0]}")

        if contacts["addresses"]:
            lines.append(f"\nAddress:     {contacts['addresses'][0]}")
            if len(contacts["addresses"]) > 1:
                lines.append(f"  (also: {', '.join(contacts['addresses'][1:])})")

        if contacts["socials"]:
            lines.append("\nSocial Profiles:")
            for platform, link in contacts["socials"].items():
                lines.append(f"  {platform.capitalize()}: {link}")

        lines.append(f"\nDescription: {description if description else 'NOT FOUND'}")

        if person_names:
            lines.append(f"\nPerson(s) found: {', '.join(person_names)}")

        if primary_email == "NOT FOUND" and primary_phone == "NOT FOUND":
            lines.append(
                "\n⚠️  No direct contact details found. Company may use a contact form. "
                "Try web_fetch_page on their /contact page."
            )

        return "\n".join(lines)

    return _safe_call(f"extract contacts from '{url}'", run)


WEB_TOOLS = [web_search, web_fetch_page, web_crawl, web_company_search, web_company_extract]

__all__ = [
    "web_search",
    "web_fetch_page",
    "web_crawl",
    "web_company_search",
    "web_company_extract",
    "WEB_TOOLS",
    "_safe_call",
    "_clean_text",
    "_page_title",
    "_allowed_by_robots",
    "_is_non_official_host",
    "_fetch_soup",
    "_extract_contacts_from_soup",
    "_extract_description",
    "_extract_person_names",
    "_find_subpage_links",
]
