# web/company_resolver.py

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, asdict
from difflib import SequenceMatcher
from typing import Optional, Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


logger = logging.getLogger("company-resolver")


# ============================================================================
# CONFIG
# ============================================================================

# Show the user the first three usable Google results, in Google's order.
# We request a few extra results internally because directories and social
# profiles are deliberately excluded from official-website candidates.
MAX_DISCOVERY_RESULTS = 3
GOOGLE_SEARCH_FETCH_LIMIT = 10
MCA_MASTER_DATA_RESOURCE_ID = "4dbe5667-7b6b-41d7-82af-211562424d9a"
MCA_MASTER_DATA_API_URL = "https://api.data.gov.in/resource/" + MCA_MASTER_DATA_RESOURCE_ID
GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

MAX_CRAWL_PAGES = 3

MIN_VERIFIED_CONFIDENCE = 0.72

# These domains are NOT official company websites.
BLOCKED_DOMAINS = {
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "wikipedia.org",

    "crunchbase.com",
    "bloomberg.com",
    "reuters.com",

    "glassdoor.com",
    "indeed.com",
    "ambitionbox.com",

    "zaubacorp.com",
    "tofler.in",
    "indiafilings.com",
    "thecompanycheck.com",

    "justdial.com",
    "indiamart.com",
    "tradeindia.com",
    "exportersindia.com",
    "sulekha.com",
}


CONTACT_WORDS = (
    "contact",
    "contact-us",
    "contactus",
    "reach-us",
    "reachus",
)


ABOUT_WORDS = (
    "about",
    "about-us",
    "aboutus",
    "company",
)


# ============================================================================
# RESULT MODELS
# ============================================================================

@dataclass
class DiscoveryCandidate:

    id: int

    name: str

    website: str

    title: str = ""

    snippet: str = ""

    score: float = 0.0

    source: str = "web"


@dataclass
class CompanyResult:

    status: str

    query: str

    confidence: float = 0.0

    question: Optional[str] = None

    company_name: Optional[str] = None

    website: Optional[str] = None

    email: Optional[str] = None

    phone: Optional[str] = None

    address: Optional[str] = None

    description: Optional[str] = None

    industry: Optional[str] = None

    linkedin: Optional[str] = None

    candidates: list[dict[str, Any]] = None

    source_pages: list[str] = None

    evidence: list[str] = None

    error: Optional[str] = None

    def __post_init__(self):

        if self.candidates is None:
            self.candidates = []

        if self.source_pages is None:
            self.source_pages = []

        if self.evidence is None:
            self.evidence = []

    def to_dict(self):

        return asdict(self)


# ============================================================================
# NORMALIZATION
# ============================================================================

def normalize(value: str) -> str:

    if not value:
        return ""

    value = value.lower()

    value = value.replace("&", " and ")

    value = re.sub(
        r"[^a-z0-9]+",
        " ",
        value,
    )

    return re.sub(
        r"\s+",
        " ",
        value,
    ).strip()


def company_tokens(value: str) -> set[str]:

    ignored = {
        "pvt",
        "private",
        "ltd",
        "limited",
        "llp",
        "inc",
        "incorporated",
        "corp",
        "corporation",
        "company",
        "co",
        "the",
        "and",
    }

    return {
        x
        for x in normalize(value).split()
        if x not in ignored
    }


def similarity(
    a: str,
    b: str,
) -> float:

    a = normalize(a)
    b = normalize(b)

    if not a or not b:
        return 0.0

    sequence = SequenceMatcher(
        None,
        a,
        b,
    ).ratio()

    at = company_tokens(a)
    bt = company_tokens(b)

    if at or bt:

        token_score = len(
            at & bt
        ) / max(
            len(at | bt),
            1,
        )

    else:

        token_score = 0.0

    return (
        sequence * 0.65
        +
        token_score * 0.35
    )


# ============================================================================
# DOMAIN
# ============================================================================

def host(url: str) -> str:

    return urlparse(
        url
    ).netloc.lower().split(":")[0]


def root_domain(url: str) -> str:

    value = host(url)

    value = value.removeprefix("www.")

    parts = value.split(".")

    if len(parts) >= 3 and parts[-2] in {
        "co",
        "com",
        "net",
        "org",
    }:

        return ".".join(
            parts[-3:]
        )

    if len(parts) >= 2:

        return ".".join(
            parts[-2:]
        )

    return value


def domain_name(url: str) -> str:

    domain = root_domain(url)

    if "." in domain:

        return domain.rsplit(
            ".",
            1,
        )[0]

    return domain


def blocked_domain(url: str) -> bool:

    domain = root_domain(url)

    return any(
        domain == blocked
        or domain.endswith(
            "." + blocked
        )
        for blocked in BLOCKED_DOMAINS
    )


def official_signal_score(url: str, title: str, snippet: str) -> float:

    text = normalize(f"{url} {title} {snippet}")
    score = 0.0

    if any(word in text for word in ("official", "website", "homepage", "home page")):
        score += 0.20
    if any(word in text for word in ("about", "contact", "careers", "privacy", "terms")):
        score += 0.10
    if any(word in text for word in ("inc", "ltd", "llp", "pvt", "private", "limited")):
        score += 0.05

    dn = domain_name(url)
    if len(dn) <= 16:
        score += 0.05
    if "-" not in dn:
        score += 0.05
    elif dn.count("-") == 1:
        score += 0.02

    if blocked_domain(url):
        score -= 1.0

    return max(0.0, min(score, 0.35))


def domain_quality_score(url: str) -> float:

    domain = root_domain(url)
    score = 0.0

    if domain.endswith(".com"):
        score += 0.05
    elif domain.endswith((".in", ".co", ".net", ".org")):
        score += 0.03

    if re.search(r"\b(company|group|global|india|tech|systems|solutions|services)\b", domain):
        score += 0.03

    return min(score, 0.08)


# ============================================================================
# COMPANY IDENTITY: INDIA MCA OPEN DATA
# ============================================================================

def _env_value(name: str) -> str:
    """Read configuration at call time so deployments can rotate keys safely."""
    return os.environ.get(name, "").strip()


def _record_value(record: dict, *names: str) -> str:
    """Accept the field-name variations used across OGD resource versions."""
    normalized = {
        normalize(str(key)).replace(" ", "_"): value
        for key, value in record.items()
    }
    for name in names:
        value = normalized.get(normalize(name).replace(" ", "_"))
        if value not in (None, ""):
            return str(value).strip()
    return ""


def discover_indian_companies(company_name: str) -> list[dict]:
    """Look up legal Indian company records in MCA's data.gov.in resource.

    An individual data.gov.in API key is required. The official API's name filter
    is exact, so an unavailable or non-exact result intentionally falls through
    to web discovery rather than claiming a legal-entity match.
    """
    api_key = _env_value("DATA_GOV_IN_API_KEY")
    if not api_key:
        return []

    try:
        response = requests.get(
            MCA_MASTER_DATA_API_URL,
            params={
                "api-key": api_key,
                "format": "json",
                "limit": MAX_DISCOVERY_RESULTS,
                "filters[COMPANY_NAME]": company_name,
            },
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("MCA master-data lookup unavailable: %s", exc)
        return []

    raw_records = payload.get("records", []) if isinstance(payload, dict) else []
    candidates: list[dict] = []
    seen_cins: set[str] = set()
    for record in raw_records:
        if not isinstance(record, dict):
            continue
        cin = _record_value(record, "CORPORATE_IDENTIFICATION_NUMBER", "CIN")
        name = _record_value(record, "COMPANY_NAME", "COMPANY NAME")
        if not cin or not name or cin in seen_cins:
            continue
        seen_cins.add(cin)
        candidates.append(
            {
                "id": len(candidates) + 1,
                "name": name,
                "cin": cin,
                "status": _record_value(record, "COMPANY_STATUS", "COMPANY STATUS"),
                "incorporation_date": _record_value(record, "DATE_OF_REGISTRATION", "DATE OF REGISTRATION"),
                "state": _record_value(record, "REGISTERED_STATE", "REGISTERED STATE", "STATE"),
                "registered_address": _record_value(record, "REGISTERED_OFFICE_ADDRESS", "REGISTERED OFFICE ADDRESS"),
                "source": "mca_data_gov_in",
            }
        )
        if len(candidates) >= MAX_DISCOVERY_RESULTS:
            break
    return candidates


def company_identity_stage(company_name: str) -> Optional[CompanyResult]:
    """Return an MCA selection step when official records are available."""
    candidates = discover_indian_companies(company_name)
    if not candidates:
        return None
    return CompanyResult(
        status="clarification_required",
        query=company_name,
        question=(
            f"I found these registered Indian companies for '{company_name}'. "
            "Which legal entity do you mean? Reply with the candidate number or CIN."
        ),
        candidates=candidates,
        evidence=["Legal-entity candidates were returned by MCA master data via data.gov.in."],
    )


# ============================================================================
# FAST SEARCH
# ============================================================================

def _google_places_search(company_name: str, search_hint: Optional[str] = None) -> list[dict]:
    """Use the supported Google Places API to obtain public business websites."""
    api_key = _env_value("GOOGLE_MAPS_API_KEY")
    if not api_key:
        return []

    query = " ".join(part for part in (company_name, search_hint, "India") if part)
    try:
        response = requests.post(
            GOOGLE_PLACES_TEXT_SEARCH_URL,
            headers={
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": (
                    "places.displayName,places.formattedAddress,places.websiteUri,"
                    "places.googleMapsUri,places.primaryType"
                ),
            },
            json={"textQuery": query, "regionCode": "IN", "pageSize": MAX_DISCOVERY_RESULTS},
            timeout=15,
        )
        response.raise_for_status()
        places = response.json().get("places", [])
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Google Places discovery unavailable: %s", exc)
        return []

    results: list[dict] = []
    for place in places:
        if not isinstance(place, dict):
            continue
        website = place.get("websiteUri") or ""
        if not website.startswith(("http://", "https://")) or blocked_domain(website):
            continue
        name = (place.get("displayName") or {}).get("text") or ""
        address = place.get("formattedAddress") or ""
        results.append(
            {
                "href": website,
                "title": name,
                "body": address,
                "source": "google_places",
                "maps_url": place.get("googleMapsUri") or "",
            }
        )
    return _usable_search_results(results, "google_places")


def _google_search(query: str, num_results: int):
    """Keep the third-party import isolated so DDGS remains a usable fallback."""
    from googlesearch import search

    return search(query, num_results=num_results)


def _usable_search_results(items, source: str) -> list[dict]:
    """Normalise URLs while retaining the engine's ranking order."""
    results: list[dict] = []
    seen_domains: set[str] = set()

    for item in items:
        # googlesearch-python returns URL strings. Supporting mapping values here
        # also keeps the fallback's DDGS result shape compatible.
        if isinstance(item, str):
            url, title, snippet = item, "", ""
        elif isinstance(item, dict):
            url = item.get("href") or item.get("link") or item.get("url") or ""
            title = item.get("title") or ""
            snippet = item.get("body") or item.get("snippet") or ""
        else:
            continue

        if not url.startswith(("http://", "https://")):
            continue
        domain = root_domain(url)
        if blocked_domain(url) or domain in seen_domains:
            continue
        seen_domains.add(domain)
        results.append(
            {"href": url, "title": title, "body": snippet, "source": source}
        )
        if len(results) >= MAX_DISCOVERY_RESULTS:
            break

    return results


def search_query(query: str) -> list[dict]:
    """Legacy Google Search/DDGS fallback for website discovery."""

    try:
        google_results = _usable_search_results(
            _google_search(query, GOOGLE_SEARCH_FETCH_LIMIT), "google"
        )
        if google_results:
            return google_results
        logger.warning("Google returned no usable results for company discovery: %s", query)
    except Exception as exc:
        logger.warning("Google company discovery failed; using DDGS fallback: %s", exc)

    try:
        from ddgs import DDGS

        with DDGS() as ddgs:
            return _usable_search_results(
                ddgs.text(query, max_results=GOOGLE_SEARCH_FETCH_LIMIT), "ddgs"
            )
    except Exception:
        logger.exception("DDGS fallback company discovery failed")
        return []


def search_once(company_name: str) -> list[dict]:
    """Use Google Places first, then the existing Google Search/DDGS fallback."""
    places_results = _google_places_search(company_name)
    if places_results:
        return places_results
    return search_query(f'"{company_name}" official website')


# ============================================================================
# DISCOVERY
# ============================================================================

def discover_companies(
    company_name: str,
) -> list[DiscoveryCandidate]:

    raw_results = search_once(
        company_name
    )

    candidates = []

    seen_domains = set()

    for result in raw_results:

        url = (
            result.get("href")
            or
            result.get("link")
            or
            ""
        )

        if not url.startswith(
            ("http://", "https://")
        ):
            continue

        if blocked_domain(url):
            continue

        domain = root_domain(url)

        if domain in seen_domains:
            continue

        seen_domains.add(domain)

        title = (
            result.get("title")
            or
            ""
        )

        snippet = (
            result.get("body")
            or
            result.get("snippet")
            or
            ""
        )

        # Search result can contain a title like:
        #
        # Magna Data Pvt Ltd - Home
        #
        # Remove common suffix.
        candidate_name = re.split(
            r"\s+[|–—-]\s+",
            title,
        )[0].strip()

        if not candidate_name:

            candidate_name = (
                domain_name(url)
                .replace(
                    "-",
                    " ",
                )
                .title()
            )

        name_score = similarity(company_name, candidate_name)
        domain_score = similarity(company_name, domain_name(url))
        text_score = similarity(company_name, snippet)
        signal_score = official_signal_score(url, title, snippet)
        quality_score = domain_quality_score(url)

        score = (
            0.45 * name_score
            + 0.25 * domain_score
            + 0.10 * text_score
            + 0.15 * signal_score
            + 0.05 * quality_score
        )

        candidates.append(
            DiscoveryCandidate(
                id=0,
                name=candidate_name,
                website=url,
                title=title,
                snippet=snippet,
                score=round(
                    score,
                    3,
                ),
                source=result.get("source", "web"),
            )
        )

    # Do not reorder: these are Google (or fallback DDGS) ranking positions.
    for index, candidate in enumerate(
        candidates[:MAX_DISCOVERY_RESULTS],
        start=1,
    ):

        candidate.id = index

    return candidates[:MAX_DISCOVERY_RESULTS]


# ============================================================================
# STAGE 1
# ============================================================================

def discovery_stage(
    company_name: str,
) -> CompanyResult:

    """
    FIRST CALL.

    Absolutely NO Crawl4AI here.

    We only search and ask the user to identify the company.
    """

    candidates = discover_companies(
        company_name
    )

    if not candidates:

        return CompanyResult(
            status="not_found",
            query=company_name,
            question=(
                f"I couldn't find companies matching "
                f"'{company_name}'. "
                f"Could you provide the city, country, "
                f"industry, or official website?"
            ),
        )

    formatted = []

    for candidate in candidates:

        formatted.append(
            {
                "id": candidate.id,
                "name": candidate.name,
                "website": candidate.website,
                "score": candidate.score,
                "snippet": candidate.snippet[:300],
                "source": candidate.source,
            }
        )

    # IMPORTANT:
    #
    # We intentionally ask even if the first candidate looks good.
    #
    # This prevents:
    #
    # Magna Data Pvt Ltd
    #        ↓
    # Magna Data Solutions
    #
    # from silently becoming the selected company.

    question = (
        f"I found these official-website candidates for "
        f"'{company_name}'. Which one do you mean?\n\n"
        "They are shown in search-ranking order. You can reply with the candidate number, "
        "or give me another detail such as city, country, "
        "industry, or official website."
    )

    return CompanyResult(
        status="clarification_required",
        query=company_name,
        confidence=0.0,
        question=question,
        candidates=formatted,
    )


# ============================================================================
# TARGETED SEARCH AFTER USER CLARIFICATION
# ============================================================================

def targeted_search(
    company_name: str,
    hint: str,
) -> list[DiscoveryCandidate]:

    """
    SECOND SEARCH.

    Now we have extra information, so we search for:

        "Magna Data Pvt Ltd" Pune Maharashtra official website

    instead of searching the entire web blindly.
    """

    query = (
        f'"{company_name}" '
        f'"{hint}" '
        f'official website'
    )

    results = _google_places_search(company_name, hint) or search_query(query)

    candidates = []

    seen = set()

    for result in results:

        url = (
            result.get("href")
            or
            result.get("link")
            or
            ""
        )

        if not url.startswith(
            ("http://", "https://")
        ):
            continue

        if blocked_domain(url):
            continue

        domain = root_domain(url)

        if domain in seen:
            continue

        seen.add(domain)

        title = (
            result.get("title")
            or
            ""
        )

        snippet = (
            result.get("body")
            or
            result.get("snippet")
            or
            ""
        )

        candidate_name = re.split(
            r"\s+[|–—-]\s+",
            title,
        )[0].strip()

        if not candidate_name:

            candidate_name = domain_name(
                url
            ).replace(
                "-",
                " ",
            ).title()

        name_score = similarity(company_name, candidate_name)
        hint_score = similarity(hint, f"{title} {snippet}")
        domain_score = similarity(company_name, domain_name(url))
        signal_score = official_signal_score(url, title, snippet)
        quality_score = domain_quality_score(url)

        score = (
            0.40 * name_score
            + 0.30 * hint_score
            + 0.15 * domain_score
            + 0.10 * signal_score
            + 0.05 * quality_score
        )

        candidates.append(
            DiscoveryCandidate(
                id=0,
                name=candidate_name,
                website=url,
                title=title,
                snippet=snippet,
                score=round(
                    score,
                    3,
                ),
                source=result.get("source", "web"),
            )
        )

    # Keep the search-engine order here too; a hint refines the query but
    # does not change the user's right to choose from the returned websites.
    for index, candidate in enumerate(candidates[:MAX_DISCOVERY_RESULTS], start=1):
        candidate.id = index

    return candidates[:MAX_DISCOVERY_RESULTS]


# ============================================================================
# CRAWL ONLY ONE WEBSITE
# ============================================================================

async def crawl_website(
    website: str,
) -> list[tuple[str, str]]:

    """
    Crawl ONLY the selected website.

    We intentionally do not deep crawl.
    """

    try:

        from crawl4ai import (
            AsyncWebCrawler,
            BrowserConfig,
            CrawlerRunConfig,
            CacheMode,
        )

    except ImportError:

        raise RuntimeError(
            "crawl4ai is not installed."
        )

    browser_config = BrowserConfig(
        browser_type="chromium",
        headless=True,
        verbose=False,
    )

    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,

        wait_until="domcontentloaded",

        page_timeout=15000,

        word_count_threshold=5,

        remove_overlay_elements=True,
    )

    pages = []

    async with AsyncWebCrawler(
        config=browser_config
    ) as crawler:

        # --------------------------------------------------------------
        # PAGE 1: HOME
        # --------------------------------------------------------------

        result = await crawler.arun(
            website,
            config=run_config,
        )

        if not result.success:

            return []

        pages.append(
            (
                result.url or website,
                result.cleaned_html
                or result.html
                or "",
            )
        )

        # --------------------------------------------------------------
        # FIND ONLY CONTACT/ABOUT PAGES
        # --------------------------------------------------------------

        links = []

        try:

            internal = (
                result.links.get(
                    "internal",
                    [],
                )
                if result.links
                else []
            )

            for item in internal:

                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                href = item.get(
                    "href"
                )

                text = item.get(
                    "text",
                    "",
                )

                if not href:
                    continue

                absolute = urljoin(
                    website,
                    href,
                )

                if root_domain(
                    absolute
                ) != root_domain(
                    website
                ):
                    continue

                label = normalize(
                    f"{text} {absolute}"
                )

                if (
                    any(
                        word in label
                        for word in CONTACT_WORDS
                    )
                    or
                    any(
                        word in label
                        for word in ABOUT_WORDS
                    )
                ):

                    links.append(
                        absolute
                    )

        except Exception:

            links = []

        # Deduplicate.
        unique_links = []

        for link in links:

            if link not in unique_links:

                unique_links.append(
                    link
                )

        # Only 2 additional pages.
        unique_links = unique_links[
            : MAX_CRAWL_PAGES - 1
        ]

        for link in unique_links:

            try:

                page = await crawler.arun(
                    link,
                    config=run_config,
                )

                if page.success:

                    pages.append(
                        (
                            page.url or link,
                            page.cleaned_html
                            or page.html
                            or "",
                        )
                    )

            except Exception:

                continue

    return pages


def crawl_selected_website(
    website: str,
) -> list[tuple[str, str]]:

    return asyncio.run(
        crawl_website(
            website
        )
    )


# ============================================================================
# EXTRACTION
# ============================================================================

def normalize_email(
    value: str,
) -> Optional[str]:

    value = (
        value
        .strip()
        .strip(
            ".,;:()[]<>"
        )
        .lower()
    )

    pattern = (
        r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
        r"@"
        r"[A-Za-z0-9-]+"
        r"(?:\.[A-Za-z0-9-]+)+$"
    )

    if not re.fullmatch(
        pattern,
        value,
    ):

        return None

    return value


def extract_emails(
    text: str,
) -> list[str]:

    pattern = (
        r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
        r"@"
        r"[A-Za-z0-9-]+"
        r"(?:\.[A-Za-z0-9-]+)+"
    )

    emails = []

    for raw in re.findall(
        pattern,
        text or "",
    ):

        email = normalize_email(
            raw
        )

        if (
            email
            and
            email not in emails
        ):

            emails.append(
                email
            )

    return emails


def extract_phones(
    text: str,
) -> list[str]:

    patterns = [

        r"\+?\d[\d\s().-]{7,}\d",

        r"\+91[\s-]?\d{5}[\s-]?\d{5}",

    ]

    phones = []

    for pattern in patterns:

        for raw in re.findall(
            pattern,
            text or "",
        ):

            digits = re.sub(
                r"\D",
                "",
                raw,
            )

            if not (
                8
                <=
                len(digits)
                <=
                15
            ):
                continue

            if raw not in phones:

                phones.append(
                    raw.strip()
                )

    return phones[:5]


def json_ld_objects(
    soup: BeautifulSoup,
) -> list[dict]:

    objects = []

    for script in soup.find_all(
        "script",
        attrs={
            "type": re.compile(
                "application/ld\\+json",
                re.I,
            )
        },
    ):

        raw = (
            script.string
            or
            script.get_text(
                " ",
                strip=True,
            )
        )

        if not raw:
            continue

        try:

            data = json.loads(
                raw
            )

        except Exception:

            continue

        if isinstance(
            data,
            dict,
        ):

            objects.append(
                data
            )

            graph = data.get(
                "@graph"
            )

            if isinstance(
                graph,
                list,
            ):

                objects.extend(
                    x
                    for x in graph
                    if isinstance(
                        x,
                        dict,
                    )
                )

        elif isinstance(
            data,
            list,
        ):

            objects.extend(
                x
                for x in data
                if isinstance(
                    x,
                    dict,
                )
            )

    return objects


def get_address(
    value: Any,
) -> Optional[str]:

    if isinstance(
        value,
        str,
    ):

        return value.strip()

    if not isinstance(
        value,
        dict,
    ):

        return None

    parts = []

    for key in (
        "streetAddress",
        "addressLocality",
        "addressRegion",
        "postalCode",
        "addressCountry",
    ):

        value = value.get(
            key
        )

        if isinstance(
            value,
            str,
        ):

            value = value.strip()

            if value:

                parts.append(
                    value
                )

    return (
        ", ".join(
            dict.fromkeys(parts)
        )
        if parts
        else None
    )


def extract_from_pages(
    requested_company: str,
    website: str,
    pages: list[tuple[str, str]],
) -> CompanyResult:

    emails = []

    phones = []

    addresses = []

    organization_names = []

    descriptions = []

    linkedin = None

    source_pages = []

    for url, html in pages:

        source_pages.append(
            url
        )

        soup = BeautifulSoup(
            html,
            "lxml",
        )

        text = soup.get_text(
            " ",
            strip=True,
        )

        # --------------------------------------------------------------
        # EMAILS
        # --------------------------------------------------------------

        for email in extract_emails(
            text
        ):

            if email not in emails:

                emails.append(
                    email
                )

        # --------------------------------------------------------------
        # PHONE
        # --------------------------------------------------------------

        for phone in extract_phones(
            text
        ):

            if phone not in phones:

                phones.append(
                    phone
                )

        # --------------------------------------------------------------
        # MAILTO / TEL / LINKEDIN
        # --------------------------------------------------------------

        for anchor in soup.find_all(
            "a",
            href=True,
        ):

            href = anchor[
                "href"
            ].strip()

            if href.lower().startswith(
                "mailto:"
            ):

                email = normalize_email(
                    href.split(
                        ":",
                        1,
                    )[1].split(
                        "?",
                        1,
                    )[0]
                )

                if (
                    email
                    and
                    email not in emails
                ):

                    emails.append(
                        email
                    )

            elif href.lower().startswith(
                "tel:"
            ):

                phone = href.split(
                    ":",
                    1,
                )[1].strip()

                if phone not in phones:

                    phones.append(
                        phone
                    )

            absolute = urljoin(
                url,
                href,
            )

            if (
                "linkedin.com/company/"
                in
                absolute.lower()
            ):

                linkedin = absolute

        # --------------------------------------------------------------
        # JSON-LD
        # --------------------------------------------------------------

        for obj in json_ld_objects(
            soup
        ):

            types = obj.get(
                "@type"
            )

            type_text = str(
                types
            ).lower()

            if not any(
                value in type_text
                for value in (
                    "organization",
                    "corporation",
                    "localbusiness",
                )
            ):

                continue

            name = obj.get(
                "name"
            )

            if isinstance(
                name,
                str,
            ):

                if name not in organization_names:

                    organization_names.append(
                        name.strip()
                    )

            email = obj.get(
                "email"
            )

            if isinstance(
                email,
                str,
            ):

                email = normalize_email(
                    email
                )

                if (
                    email
                    and
                    email not in emails
                ):

                    emails.append(
                        email
                    )

            phone = obj.get(
                "telephone"
            )

            if isinstance(
                phone,
                str,
            ):

                if phone not in phones:

                    phones.append(
                        phone
                    )

            address = get_address(
                obj.get(
                    "address"
                )
            )

            if (
                address
                and
                address not in addresses
            ):

                addresses.append(
                    address
                )

            description = obj.get(
                "description"
            )

            if isinstance(
                description,
                str,
            ):

                descriptions.append(
                    description.strip()
                )

            same_as = obj.get(
                "sameAs"
            )

            if isinstance(
                same_as,
                str,
            ):

                same_as = [
                    same_as
                ]

            if isinstance(
                same_as,
                list,
            ):

                for item in same_as:

                    if (
                        isinstance(
                            item,
                            str,
                        )
                        and
                        "linkedin.com/company/"
                        in
                        item.lower()
                    ):

                        linkedin = item

    # --------------------------------------------------------------
    # COMPANY NAME
    # --------------------------------------------------------------

    if organization_names:

        organization_names.sort(
            key=lambda x: similarity(
                requested_company,
                x,
            ),
            reverse=True,
        )

        company_name = (
            organization_names[0]
        )

    else:

        company_name = (
            requested_company
        )

    identity_score = similarity(
        requested_company,
        company_name,
    )

    confidence = (
        0.65 * identity_score
        +
        0.10 * bool(emails)
        +
        0.10 * bool(phones)
        +
        0.10 * bool(addresses)
        +
        0.05 * bool(organization_names)
    )

    confidence = round(
        confidence,
        3,
    )

    status = (
        "verified"
        if confidence
        >=
        MIN_VERIFIED_CONFIDENCE
        else
        "low_confidence"
    )

    return CompanyResult(
        status=status,
        query=requested_company,
        confidence=confidence,
        company_name=company_name,
        website=website,
        email=(
            emails[0]
            if emails
            else None
        ),
        phone=(
            phones[0]
            if phones
            else None
        ),
        address=(
            addresses[0]
            if addresses
            else None
        ),
        description=(
            descriptions[0]
            if descriptions
            else None
        ),
        linkedin=linkedin,
        source_pages=source_pages,
        evidence=[
            "Selected website was crawled after user/company disambiguation.",
            "Contact data was extracted from the selected company's website.",
        ],
    )


# ============================================================================
# STAGE 2
# ============================================================================

def verify_selected_company(
    company_name: str,
    selected_website: str,
) -> CompanyResult:

    """
    SECOND CALL.

    At this point we know the website.

    Therefore:

        NO broad search
        NO crawling competitors
        NO crawling directories
        NO crawling LinkedIn

    We crawl ONLY this website.
    """

    try:

        pages = crawl_selected_website(
            selected_website
        )

    except Exception as exc:

        return CompanyResult(
            status="error",
            query=company_name,
            website=selected_website,
            error=str(exc),
        )

    if not pages:

        return CompanyResult(
            status="not_found",
            query=company_name,
            website=selected_website,
            question=(
                f"I selected {selected_website}, but the website "
                f"could not be read. Do you have another official "
                f"website for {company_name}?"
            ),
        )

    result = extract_from_pages(
        company_name,
        selected_website,
        pages,
    )

    return result


# ============================================================================
# PUBLIC FUNCTION
# ============================================================================

def resolve_company(
    company_name: str,
    selected_website: Optional[str] = None,
    search_hint: Optional[str] = None,
    selected_company_cin: Optional[str] = None,
) -> CompanyResult:

    """
    Public API.

    FIRST TURN:

        resolve_company(
            "Magna Data Pvt Ltd"
        )

    returns:

        clarification_required

    SECOND TURN:

        resolve_company(
            "Magna Data Pvt Ltd",
            selected_website="https://..."
        )

    crawls only that website.

    Alternatively:

        resolve_company(
            "Magna Data Pvt Ltd",
            search_hint="Pune Maharashtra"
        )

    performs one targeted search and asks the user to select a result.
    """

    company_name = (
        company_name
        or
        ""
    ).strip()

    if not company_name:

        return CompanyResult(
            status="error",
            query="",
            error="Company name is required.",
        )

    # --------------------------------------------------------------
    # If the user selected a website, SKIP DISCOVERY and crawl only it.
    # --------------------------------------------------------------

    if selected_website:

        return verify_selected_company(
            company_name,
            selected_website,
        )

    # --------------------------------------------------------------
    # If user gave clarification, perform ONE targeted search.
    # --------------------------------------------------------------

    if search_hint:

        candidates = targeted_search(
            company_name,
            search_hint,
        )

        if not candidates:

            return CompanyResult(
                status="not_found",
                query=company_name,
                question=(
                    f"I couldn't find the official website for "
                    f"{company_name} using '{search_hint}'. "
                    f"Could you provide the official website?"
                ),
            )

        return CompanyResult(
            status="clarification_required",
            query=company_name,
            question=(
                f"I found these website candidates for {company_name} using "
                f"'{search_hint}'. Which one should I crawl?"
            ),
            candidates=[
                asdict(candidate)
                for candidate in candidates[:MAX_DISCOVERY_RESULTS]
            ],
        )

    # --------------------------------------------------------------
    # The user selected an MCA legal entity. Discover websites for that
    # exact legal name, then ask for a separate website selection.
    # --------------------------------------------------------------

    if selected_company_cin:
        legal_matches = discover_indian_companies(company_name)
        legal_match = next(
            (item for item in legal_matches if item["cin"].casefold() == selected_company_cin.strip().casefold()),
            None,
        )
        if legal_match:
            return discovery_stage(legal_match["name"])
        # The API may be temporarily unavailable or its historical data may no
        # longer contain the record. Retain the supplied name and continue with
        # website discovery instead of blocking the user.
        logger.warning("Selected MCA CIN was not available for verification: %s", selected_company_cin)
        return discovery_stage(company_name)

    # --------------------------------------------------------------
    # FIRST TURN: official India company identity first, when configured.
    # If the optional data.gov.in service cannot identify the company, retain
    # the prior Google Places -> Google Search -> DDGS discovery behavior.
    # --------------------------------------------------------------

    identity_result = company_identity_stage(company_name)
    if identity_result:
        return identity_result

    return discovery_stage(
        company_name
    )
