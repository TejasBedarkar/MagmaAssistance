"""
test/test_apollo_live.py
------------------------
Utility script to test live Apollo.io API key with real enrichment queries.

Usage:
    python test/test_apollo_live.py "Satya Nadella" "Microsoft" "microsoft.com"
    python test/test_apollo_live.py "" "Zerodha" "zerodha.com"
"""

import os
import sys
from pprint import pprint

from dotenv import load_dotenv

# Suppress LangSmith network warnings in local test scripts
os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from web.apollo_client import ApolloClient
from web.apollo_tool import apollo_enrich_lead

load_dotenv()


def main():
    api_key = os.environ.get("APOLLO_API_KEY", "").strip()
    if not api_key:
        print("\n[ERROR] APOLLO_API_KEY is not set in .env!")
        print("Please add your Apollo API key to .env:")
        print("    APOLLO_API_KEY=your_key_here\n")
        return

    person = sys.argv[1] if len(sys.argv) > 1 else "Satya Nadella"
    company = sys.argv[2] if len(sys.argv) > 2 else "Microsoft"
    domain = sys.argv[3] if len(sys.argv) > 3 else None

    if person.lower() in ("none", "null", '""', "''"):
        person = None

    print(f"\n--- Running live Apollo test ---")
    print(f"   Person:  {person or '(None)'}")
    print(f"   Company: {company}")
    print(f"   Domain:  {domain or '(Auto)'}\n")

    client = ApolloClient(api_key=api_key)

    if person:
        print("1. Testing ApolloClient.match_person()...")
        res_person = client.match_person(name=person, organization_name=company, domain=domain)
        pprint(res_person)

    print("\n2. Testing ApolloClient.enrich_organization()...")
    res_org = client.enrich_organization(domain=domain, company_name=company)
    pprint(res_org)

    print("\n3. Testing complete LangChain tool (apollo_enrich_lead)...")
    tool_output = apollo_enrich_lead.invoke({
        "company_name": company,
        "person_name": person,
        "domain": domain,
    })
    print("\n" + "=" * 60)
    print(tool_output)
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
