"""
web/web_tool.py

Generic internet-access tools for the agent, following the same
LangChain `@tool` + plain-string-error pattern used by
ERP_Unified/tools.py (see `_safe_call` there). These are NOT tied to
ERPNext -- they let the agent look things up on the open internet when
the answer isn't in the ERP system.

Four tools are exposed:

  - web_search        : DuckDuckGo text search, no API key required.
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
    pip install ddgs beautifulsoup4 lxml

Nothing here needs an API key. web_search shells out to the `ddgs`
package (the actively-maintained fork of duckduckgo_search) purely for
network access -- it does not send anything to OpenAI/Anthropic.
"""

import logging
import re
import time
from typing import Optional
from urllib.parse import urljoin, urlparse
import urllib.robotparser as robotparser

import requests
from bs4 import BeautifulSoup
from langchain_core.tools import tool

logger = logging.getLogger("web-tools")

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
    """Searches the public internet (DuckDuckGo, no API key needed) for
    up-to-date information that isn't in the ERP system -- news, product
    specs, general knowledge, current events, company/person lookups,
    documentation, etc. Returns a numbered list of results, each with a
    title, URL, and short snippet. Call web_fetch_page on a specific URL
    from the results afterwards if you need the full page content rather
    than just the snippet. Keep `query` short and specific, like a real
    search-box query, not a full sentence."""

    n = max(1, min(int(max_results or 5), _MAX_SEARCH_RESULTS))

    def run():
        from ddgs import DDGS  # imported lazily so the rest of the app
                                # still works even if ddgs isn't installed

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=n))

        if not results:
            return f"No web results found for '{query}'."

        lines = [f"Web search results for '{query}':"]
        for i, r in enumerate(results, start=1):
            title = r.get("title", "(no title)")
            url = r.get("href") or r.get("link") or ""
            snippet = (r.get("body") or "").strip()
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


# Per-process cache keyed by normalized company name, so a rate-limited
# or already-answered lookup doesn't get re-run (and potentially fail
# differently) later in the same conversation/flow -- e.g. right after
# the agent already ran this once and the user then supplies one of the
# still-missing fields manually, it should NOT trigger a second live
# search. Cleared on process restart, same tradeoff as every other
# in-memory store in this app (_PENDING_CREATES, MemorySaver, etc.).
_LOOKUP_CACHE: dict[str, str] = {}


@tool
def web_company_lookup(company_name: str) -> str:
    """Looks up a real company's PUBLIC contact info on the web to help
    pre-fill an ERP record (Lead, Customer, etc.) when the user gives
    just a company name -- e.g. 'create a lead for Infosys'. Finds the
    company's own official website (never a Wikipedia/LinkedIn/news/
    directory result), then reads its homepage -- and its "Contact"
    page too, if the homepage itself has no direct contact link -- for
    a published email address and phone number (from mailto:/tel: links
    only, never guessed) plus a short site description. Returns ONLY
    what it verifiably finds, clearly labeled, and says 'not found' for
    anything it can't confirm -- it never invents a value or a
    workaround. Call this AT MOST ONCE per company per task: if it
    already ran for this company earlier in the conversation, reuse
    that result instead of calling it again (it's cached automatically
    either way, but don't rely on that -- treat one lookup as final).
    After calling this, use only the fields it found to fill in
    erp_data_tool's `data`, tell the user which fields were auto-filled
    from the web, and ask the user directly for whatever it reports as
    'not found' -- report 'not found' as exactly that, never rephrase it
    into something that sounds like a real answer."""

    name = (company_name or "").strip()
    if not name:
        return "Please provide a company name to look up."

    cache_key = name.lower()
    if cache_key in _LOOKUP_CACHE:
        return _LOOKUP_CACHE[cache_key]

    def run():
        try:
            from ddgs import DDGS
        except ImportError:
            return "Web lookup is unavailable (the 'ddgs' package isn't installed). Ask the user for details directly."

        try:
            with DDGS() as ddgs:
                results = list(ddgs.text(f"{name} official website", max_results=8))
        except Exception as exc:  # noqa: BLE001
            # Search backend hiccup/rate-limit -- fail soft with a plain
            # sentence instead of letting the raw exception (and a later
            # retry hitting the same failure) confuse the conversation.
            logger.warning("web_company_lookup search failed for %r: %s", name, exc)
            return f"Web search is temporarily unavailable. Ask the user for {name}'s contact details directly."

        # Drop directories/social/news/reference hosts outright -- these
        # rank highly for almost any company but are never its own site.
        results = [
            r for r in results
            if not _is_non_official_host(urlparse(r.get("href") or r.get("link") or "").netloc)
        ]
        if not results:
            return f"No official website found for '{name}'. Ask the user for contact details directly."

        # Prefer a result whose registrable domain matches the company
        # name closely (e.g. 'infosys.com' for 'Infosys'), not just any
        # substring match anywhere in the hostname.
        target_slug = _slug(name)

        def score(r):
            netloc = urlparse(r.get("href") or r.get("link") or "").netloc
            domain = _slug(_registrable_domain(netloc))
            if target_slug and (domain == target_slug or domain.startswith(target_slug[:6])):
                return 0
            return 1

        results.sort(key=score)
        candidates = [
            (r.get("href") or r.get("link"))
            for r in results[:_LOOKUP_CANDIDATE_PAGES]
            if r.get("href") or r.get("link")
        ]

        emails, phones = [], []
        official_url, description = None, ""
        pages_checked, unreachable = [], []

        for url in candidates:
            try:
                resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
                resp.raise_for_status()
            except requests.exceptions.RequestException:
                # Large corporate sites frequently block plain bot
                # requests (403 / Cloudflare challenge / timeout) even
                # though the site is perfectly real -- remember it as a
                # candidate anyway so we can still report a website URL
                # even if we couldn't read the page.
                unreachable.append(url)
                continue
            if "html" not in resp.headers.get("Content-Type", ""):
                unreachable.append(url)
                continue

            soup = BeautifulSoup(resp.text, "html.parser")
            pages_checked.append(url)
            if official_url is None:
                official_url = url
                meta = soup.find("meta", attrs={"name": "description"}) or soup.find(
                    "meta", attrs={"property": "og:description"}
                )
                if meta and meta.get("content"):
                    description = meta["content"].strip()[:300]

            emails, phones = _extract_contacts(soup)

            # Homepages rarely put mailto:/tel: links front and center --
            # follow one "Contact"-style link from THIS page if nothing
            # turned up yet, before moving to the next search candidate.
            if not emails and not phones:
                contact_url = _find_contact_page_link(soup, url)
                if contact_url and contact_url not in pages_checked:
                    try:
                        c_resp = requests.get(contact_url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
                        c_resp.raise_for_status()
                        if "html" in c_resp.headers.get("Content-Type", ""):
                            c_soup = BeautifulSoup(c_resp.text, "html.parser")
                            pages_checked.append(contact_url)
                            emails, phones = _extract_contacts(c_soup)
                    except requests.exceptions.RequestException:
                        pass

            if emails or phones:
                break  # got contact info, no need to check more candidates

        if not official_url:
            if unreachable:
                # We know the likely website (from the search ranking)
                # even though every candidate blocked our fetch -- still
                # report that rather than giving up completely, so the
                # agent doesn't have to ask the user for something we
                # already found.
                lines = [f"Web lookup for '{name}':"]
                lines.append(f"- website: {unreachable[0]} (found via search; page could not be fetched to read further)")
                lines.append("- email: not found")
                lines.append("- phone: not found")
                lines.append(
                    "Only the website above is verified. Email and phone are "
                    "genuinely not found -- report them as not found and ask "
                    "the user directly instead of guessing."
                )
                return "\n".join(lines)
            return f"Could not find or reach any candidate site for '{name}'. Ask the user for contact details directly."

        lines = [f"Web lookup for '{name}' (checked: {', '.join(pages_checked)}):"]
        lines.append(f"- website: {official_url}")
        lines.append(f"- email: {emails[0] if emails else 'not found'}")
        lines.append(f"- phone: {phones[0] if phones else 'not found'}")
        if description:
            lines.append(f"- description: {description}")
        if len(emails) > 1:
            lines.append(f"  (other emails found on the page: {', '.join(emails[1:])})")
        if len(phones) > 1:
            lines.append(f"  (other phones found on the page: {', '.join(phones[1:])})")
        lines.append(
            "Only these verified values may be used to fill ERP fields "
            "(email/phone/website/company/industry hints, etc.). A field "
            "marked 'not found' means exactly that -- report it to the user "
            "as not found, do not rephrase it into anything that sounds "
            "like an answer, and ask the user for it directly instead."
        )
        return "\n".join(lines)

    result = _safe_call(f"look up company info for '{name}'", run)
    _LOOKUP_CACHE[cache_key] = result
    return result


WEB_TOOLS = [web_search, web_fetch_page, web_crawl, web_company_lookup]
