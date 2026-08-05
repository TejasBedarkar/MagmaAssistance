"""Serper-backed, read-only public-web research tools."""

import json
import os
import re
from typing import Any

import requests
from dotenv import load_dotenv
from langchain_core.tools import tool


load_dotenv()


SERPER_SEARCH_URL = os.environ.get("SERPER_SEARCH_URL", "https://google.serper.dev/search")
SERPER_TIMEOUT_SECONDS = float(os.environ.get("SERPER_TIMEOUT_SECONDS", "15"))


def _search_serper(query: str, num_results: int) -> dict[str, Any]:
    api_key = os.environ.get("SERPER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "Serper web search is not configured. Set SERPER_API_KEY and restart the server."
        )

    try:
        response = requests.post(
            SERPER_SEARCH_URL,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": query, "num": num_results},
            timeout=SERPER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.Timeout as exc:
        raise RuntimeError("Serper web search timed out; try the research request again.") from exc
    except requests.RequestException as exc:
        status = getattr(exc.response, "status_code", None)
        detail = f" (HTTP {status})" if status else ""
        raise RuntimeError(f"Serper web search failed{detail}.") from exc
    except ValueError as exc:
        raise RuntimeError("Serper returned an invalid response.") from exc

    return payload


def _result_rows(payload: dict[str, Any], query: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for item in payload.get("organic", []) or []:
        link = str(item.get("link") or "").strip()
        if not link:
            continue
        rows.append(
            {
                "query": query,
                "title": str(item.get("title") or "").strip(),
                "url": link,
                "snippet": str(item.get("snippet") or "").strip(),
                "date": str(item.get("date") or "").strip(),
            }
        )
    return rows


def _company_search_name(company_name: str) -> str:
    """Remove punctuation/legal suffix noise that often kills exact searches."""
    cleaned = re.sub(r"[^\w\s]", " ", company_name, flags=re.UNICODE)
    cleaned = re.sub(
        r"\b(private|pvt|limited|ltd|llp|incorporated|inc|corporation|corp)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", cleaned).strip() or company_name


@tool
def research_lead_web(
    person_name: str,
    company_name: str,
    location: str = "",
    max_results: int = 15,
) -> str:
    """Research a named person at a named company on the public web using
    Serper. Use this whenever a user asks to find, verify, enrich, or research
    a Lead/person/company from public sources. It is READ-ONLY: it returns
    search evidence and source URLs and never creates or updates an ERP Lead.
    After calling it, show only Lead fields supported by the evidence, include
    a source URL for each value, label uncertain matches, and wait for explicit
    user approval before calling any ERP write operation. Never infer gender,
    consent/subscription fields, private contact details, or unsupported facts.
    """
    person = (person_name or "").strip()
    company = (company_name or "").strip()
    if not person or not company:
        return "Both person_name and company_name are required for Lead research."

    capped_results = max(3, min(int(max_results or 15), 30))
    per_query = max(3, min(10, (capped_results + 2) // 3))
    context = f' "{location.strip()}"' if location and location.strip() else ""
    company_search = _company_search_name(company)
    queries = [
        f'"{person}" {company_search}{context}',
        f'"{person}" {company_search} job title email phone{context}',
        f'site:linkedin.com/in "{person}" {company_search}{context}',
    ]

    evidence: list[dict[str, str]] = []
    errors: list[str] = []
    for query in queries:
        try:
            evidence.extend(_result_rows(_search_serper(query, per_query), query))
        except RuntimeError as exc:
            errors.append(str(exc))

    deduplicated: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for row in evidence:
        normalized_url = row["url"].rstrip("/").lower()
        if normalized_url in seen_urls:
            continue
        seen_urls.add(normalized_url)
        deduplicated.append(row)
        if len(deduplicated) >= capped_results:
            break

    if not deduplicated:
        reason = errors[0] if errors else "No matching public results were returned."
        return f"No public-web evidence found for {person} at {company}. {reason}"

    result = {
        "research_subject": {"person_name": person, "company_name": company},
        "instructions": (
            "Treat these as search leads, not automatically verified facts. Cross-check the "
            "person-company match, cite the supporting URL beside every extracted Lead field, "
            "omit unsupported fields, and do not create/update a Lead without approval."
        ),
        "evidence": deduplicated,
    }
    if errors:
        result["warnings"] = sorted(set(errors))
    return json.dumps(result, ensure_ascii=False)


WEB_TOOLS = [research_lead_web]
