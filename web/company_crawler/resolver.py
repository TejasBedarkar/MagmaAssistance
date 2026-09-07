"""
resolver.py
-----------
Resolves a company NAME -> ranked list of candidate OFFICIAL websites with a
confidence score, using free search backends + multi-signal scoring.

Why this approach (vs. "just take the first search result"):
  A single search hit is unreliable because directories, news articles, and
  similarly-named companies routinely outrank the real homepage. Instead we:
    1. Pull several search results (not just #1).
    2. Score each candidate domain on multiple independent signals.
    3. Return the top 3, ranked, with a transparent confidence score so a
       human can make the final call (this is the most reliable fix of all).
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests
import tldextract
from rapidfuzz import fuzz

from .blocklist import is_non_official

# Use tldextract's bundled offline snapshot instead of fetching the public
# suffix list from the internet on every run — faster and works without
# extra network access.
_tld_extractor = tldextract.TLDExtract(suffix_list_urls=())


def _extract_domain_parts(url_or_domain: str):
    return _tld_extractor(url_or_domain)


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

REQUEST_TIMEOUT = 8


@dataclass
class Candidate:
    url: str
    domain: str
    title: str = ""
    snippet: str = ""
    score: float = 0.0
    reasons: list = field(default_factory=list)

    def as_dict(self):
        return {
            "url": self.url,
            "domain": self.domain,
            "title": self.title,
            "confidence": round(self.score, 3),
            "reasons": self.reasons,
        }


def _search_duckduckgo(query: str, max_results: int = 10, debug: bool = False) -> list[dict]:
    """
    Free, keyless search backend. Returns [] on failure (never raises upward),
    but prints the underlying error when debug=True so failures are diagnosable.
    """
    try:
        from ddgs import DDGS

        with DDGS(timeout=10) as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        return [{"url": r.get("href", ""), "title": r.get("title", ""),
                 "snippet": r.get("body", "")} for r in results if r.get("href")]
    except Exception as e:
        if debug:
            print(f"  [debug] DuckDuckGo search failed: {type(e).__name__}: {e}")
        return []


def _search_tavily(query: str, max_results: int = 10) -> list[dict]:
    """Tavily search backend for fast, high-accuracy web resolution."""
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return []
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        res = client.search(query=query, max_results=max_results, search_depth="basic")
        results = []
        for r in res.get("results", []):
            results.append({
                "url": r.get("url", ""),
                "title": r.get("title", ""),
                "snippet": r.get("content", ""),
            })
        return results
    except Exception:
        return []


def _search_google_cse(query: str, api_key: str, cse_id: str, max_results: int = 10) -> list[dict]:
    """
    Optional, higher-quality backend using Google Programmable Search Engine.
    Free tier: 100 queries/day. Requires GOOGLE_API_KEY + GOOGLE_CSE_ID.
    """
    out = []
    try:
        num = min(max_results, 10)
        resp = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": api_key, "cx": cse_id, "q": query, "num": num},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items", []):
            out.append({
                "url": item.get("link", ""),
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
            })
    except Exception:
        pass
    return out


def _registered_domain(url: str) -> str:
    ext = _extract_domain_parts(url)
    if not ext.domain:
        return ""
    return f"{ext.domain}.{ext.suffix}" if ext.suffix else ext.domain


def _normalize_name(name: str) -> str:
    """Strip legal suffixes/punctuation for fairer comparison against domains."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9\s]", " ", name)
    suffixes = [
        "inc", "incorporated", "ltd", "limited", "llc", "llp", "corp",
        "corporation", "co", "company", "pvt", "private", "plc", "gmbh", "sa", "srl",
    ]
    tokens = [t for t in name.split() if t not in suffixes]
    return " ".join(tokens).strip()


def _is_acronym_match(company_name: str, domain_sld: str) -> bool:
    """Checks if domain SLD matches the acronym or initials of company name (e.g. TCS -> Tata Consultancy Services, SBI -> State Bank of India)."""
    norm = _normalize_name(company_name)
    words = norm.split()
    if len(words) >= 2:
        all_initials = "".join(w[0] for w in words if w)
        stop_words = {"of", "and", "the", "for", "in", "to", "a", "an", "on", "at", "by"}
        non_stop_words = [w for w in words if w not in stop_words]
        non_stop_initials = "".join(w[0] for w in non_stop_words if w)
        clean_sld = domain_sld.lower().replace("-", "")

        if clean_sld in (all_initials, non_stop_initials):
            return True
    return False


def _name_domain_similarity(company_name: str, domain: str) -> float:
    """0-100 fuzzy similarity between the company name and the domain's SLD, including acronym detection."""
    ext = _extract_domain_parts(domain)
    sld = ext.domain.replace("-", " ")
    normalized = _normalize_name(company_name)
    compact_name = normalized.replace(" ", "")
    compact_sld = sld.replace(" ", "")

    if _is_acronym_match(company_name, ext.domain):
        return 95.0

    scores = [
        fuzz.token_sort_ratio(normalized, sld),
        fuzz.ratio(compact_name, compact_sld),
        fuzz.partial_ratio(compact_name, compact_sld),
    ]
    return max(scores)


def _fetch_page_meta(url: str) -> tuple[str, str]:
    """Fetch a URL and return (title, meta_description). Fails silently -> ('','')."""
    try:
        resp = requests.get(
            url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        if resp.status_code >= 400:
            return "", ""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "lxml")
        title = soup.title.get_text(strip=True) if soup.title else ""
        desc_tag = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
        desc = desc_tag.get("content", "").strip() if desc_tag else ""
        return title, desc
    except Exception:
        return "", ""


def _probe_direct_domains(company_name: str, country_hint: str | None = None) -> list[dict]:
    """Directly probes canonical domain patterns (e.g., tatamotors.com, tatamotors.in) for fast 0-search resolution."""
    normalized = _normalize_name(company_name)
    slug = re.sub(r"[^a-z0-9]", "", normalized)
    if not slug or len(slug) < 3:
        return []

    tlds = [".com", ".in", ".co", ".org", ".io"]
    if country_hint:
        c_code = country_hint.lower().strip()[:2]
        if f".{c_code}" not in tlds:
            tlds.insert(0, f".{c_code}")

    found = []
    for tld in tlds[:3]:
        url = f"https://www.{slug}{tld}"
        title, desc = _fetch_page_meta(url)
        if title:
            found.append({
                "url": url,
                "title": title,
                "snippet": desc or f"Direct domain match for {company_name}",
            })
            break
    return found


def resolve_company_website(
    company_name: str,
    country_hint: str | None = None,
    max_candidates: int = 3,
    google_api_key: str | None = None,
    google_cse_id: str | None = None,
    verify_pages: bool = True,
    debug: bool = False,
) -> list[Candidate]:
    """
    Main entry point. Returns up to `max_candidates` Candidate objects,
    sorted by descending confidence score (0.0 - 1.0).

    Multi-tier resolution:
      1. Google CSE (if keys provided)
      2. Tavily Search (if TAVILY_API_KEY in environment)
      3. DuckDuckGo Search (free keyless backend with backoff retry)
      4. Direct Domain Probing (canonical URL probe with live title match)
    """
    query = f'{company_name} official website'
    if country_hint:
        query += f" {country_hint}"

    results = []
    # 1. Google CSE
    if google_api_key and google_cse_id:
        results = _search_google_cse(query, google_api_key, google_cse_id, max_results=10)

    # 2. Tavily Search
    if not results:
        results = _search_tavily(query, max_results=10)

    # 3. DuckDuckGo Search
    if not results:
        results = _search_duckduckgo(query, max_results=10, debug=debug)
        if not results:
            time.sleep(0.5)
            results = _search_duckduckgo(company_name, max_results=10, debug=debug)

    # 4. Direct domain probing if search engines return nothing
    if not results:
        results = _probe_direct_domains(company_name, country_hint=country_hint)

    # Deduplicate by registered domain, keep first (best-ranked) occurrence
    seen_domains = set()
    candidates: list[Candidate] = []
    for r in results:
        url = r.get("url", "")
        if not url:
            continue
        domain = _registered_domain(url)
        if not domain or domain in seen_domains:
            continue
        seen_domains.add(domain)
        candidates.append(Candidate(
            url=url, domain=domain,
            title=r.get("title", ""), snippet=r.get("snippet", ""),
        ))

    # Score each candidate
    for c in candidates:
        score = 0.0
        reasons = []

        sim = _name_domain_similarity(company_name, c.domain) / 100.0
        score += sim * 0.5
        reasons.append(f"name~domain similarity {sim:.2f} (weight 0.5)")

        if is_non_official(c.domain):
            score -= 0.6
            reasons.append("known directory/social domain (-0.6)")

        norm_name = _normalize_name(company_name)
        if norm_name and norm_name in c.title.lower().replace("-", " "):
            score += 0.15
            reasons.append("company name found in search-result title (+0.15)")

        if any(k in (c.title + c.snippet).lower() for k in ["official site", "official website", "home page"]):
            score += 0.05
            reasons.append("'official' keyword present (+0.05)")

        path = urlparse(c.url).path.strip("/")
        if path == "":
            score += 0.1
            reasons.append("root-level homepage URL (+0.1)")

        if country_hint:
            ext = _extract_domain_parts(c.domain)
            if country_hint.lower()[:2] in (ext.suffix or "").lower():
                score += 0.1
                reasons.append(f"domain TLD matches country hint '{country_hint}' (+0.1)")

        c.score = max(0.0, min(1.0, score))
        c.reasons = reasons

    candidates.sort(key=lambda c: c.score, reverse=True)
    top = candidates[:max_candidates]

    # Verification pass
    if verify_pages:
        for c in top:
            title, desc = _fetch_page_meta(f"https://{c.domain}")
            norm_name = _normalize_name(company_name)
            combined = (title + " " + desc).lower().replace("-", " ")
            if norm_name and norm_name in combined:
                c.score = min(1.0, c.score + 0.1)
                c.reasons.append("live homepage title/meta confirms company name (+0.1)")
            elif title or desc:
                c.reasons.append("live homepage fetched but name not confirmed in title/meta")
            if title:
                c.title = title

        top.sort(key=lambda c: c.score, reverse=True)

    return top