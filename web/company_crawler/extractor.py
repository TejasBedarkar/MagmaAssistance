"""
extractor.py
------------
Extracts email addresses, phone numbers, and postal addresses from a page's
HTML. Priority order (most reliable -> least reliable):
  1. schema.org JSON-LD structured data (Organization, LocalBusiness, PostalAddress, ContactPoint, Person)
  2. HTML5 Microdata (itemscope/itemprop for address, telephone, email)
  3. mailto: / tel: links (author-intended contact info)
  4. Cloudflare email-protection de-obfuscation
  5. Visible text regex (email / phone / [at][dot] obfuscation)
  6. Heuristic address-line detection and field parsing (address_line1, city, pincode, country)
"""

from __future__ import annotations

import html as html_lib
import json
import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

import phonenumbers
from bs4 import BeautifulSoup

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

# Matches "name [at] domain [dot] com", "name (at) domain (dot) com", "name at domain dot com"
OBFUSCATED_EMAIL_RE = re.compile(
    r"([a-zA-Z0-9._%+\-]+)\s*(?:[\[\(]|&#91;|&#40;)?\s*(?:at|@|&#64;)\s*(?:[\]\)]|&#93;|&#41;)?\s*([a-zA-Z0-9.\-]+)\s*(?:[\[\(]|&#91;|&#40;)?\s*(?:dot|\.)\s*(?:[\]\)]|&#93;|&#41;)?\s*([a-zA-Z]{2,})",
    re.IGNORECASE,
)

# File extensions that falsely look like emails when matched via regex (e.g. image@2x.png, icon@2x.svg)
JUNK_FILE_EXTENSIONS = {
    "png", "svg", "jpg", "jpeg", "webp", "gif", "bmp", "ico",
    "css", "js", "woff", "woff2", "ttf", "eot", "mp4", "webm", "pdf",
}

# Generic-looking addresses / third-party SaaS trackers / widgets we deprioritize or filter
LOW_VALUE_EMAIL_PATTERNS = [
    "example.com", "sentry.io", "wixpress.com", "godaddy.com",
    "yourdomain.com", "domain.com", "@2x", "@3x", "noreply@", "no-reply@",
    "donotreply@", "abuse@", "intercom.io", "cookiebot.com", "onetrust.com",
    "stripe.com", "lever.co", "greenhouse.io", "workable.com", "cloudflare.com",
    "wix.com", "wordpress.com", "hubspot.com", "zendesk.com", "freshdesk.com",
    "drift.com", "mailchimp.com", "sendgrid.com", "segment.com", "mixpanel.com",
    "usercentrics.eu", "termly.io", "iubenda.com", "schema.org", "w3.org",
    "googleapis.com",
]


ADDRESS_KEYWORDS = [
    "street", "st.", "road", "rd.", "avenue", "ave.", "floor", "suite",
    "building", "block", "sector", "lane", "nagar", "colony", "plot",
    "po box", "p.o. box", "zip", "pincode", "pin code", "mumbai", "delhi",
    "bengaluru", "bangalore", "pune", "hyderabad", "chennai", "kolkata",
    "gurgaon", "gurugram", "noida", "ahmedabad", "san francisco", "new york",
    "london", "singapore", "dubai", "india", "united states", "usa", "uk",
]

POSTAL_CODE_RE = re.compile(r"\b\d{5,6}(-\d{4})?\b|\b\d{3}\s\d{3}\b|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}")

GENERIC_EMAIL_PREFIXES = [
    "info", "contact", "enquiry", "enquiries", "inquiry", "inquiries",
    "sales", "support", "hello", "help", "office", "mail", "connect",
    "reach", "business", "query", "general", "switchboard", "frontdesk",
]

COMMON_COUNTRIES = [
    "India", "United States", "USA", "United Kingdom", "UK", "Canada", "Australia",
    "Germany", "France", "Singapore", "United Arab Emirates", "UAE", "Japan", "China",
]

COMMON_INDIAN_CITIES = [
    "Mumbai", "Delhi", "Bengaluru", "Bangalore", "Hyderabad", "Ahmedabad",
    "Chennai", "Kolkata", "Surat", "Pune", "Jaipur", "Lucknow", "Kanpur",
    "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad",
    "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Faridabad",
    "Meerut", "Rajkot", "Kalyan-Dombivli", "Vasai-Virar", "Varanasi", "Srinagar",
    "Aurangabad", "Dhanbad", "Amritsar", "Navi Mumbai", "Allahabad", "Prayagraj",
    "Ranchi", "Howrah", "Coimbatore", "Jabalpur", "Gwalior", "Vijayawada",
    "Jodhpur", "Madurai", "Raipur", "Kota", "Guwahati", "Chandigarh", "Solapur",
    "Hubballi-Dharwad", "Bareilly", "Moradabad", "Mysore", "Gurgaon", "Gurugram",
    "Aligarh", "Jalandhar", "Tiruchirappalli", "Bhubaneswar", "Salem", "Mira-Bhayandar",
    "Warangal", "Thiruvananthapuram", "Bhiwandi", "Saharanpur", "Guntur", "Amravati",
    "Bikaner", "Noida", "Jamshedpur", "Bhilai", "Cuttack", "Firozabad", "Kochi",
]

COMMON_INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa",
    "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
    "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
    "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
    "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir",
    "Ladakh", "Puducherry", "Chandigarh",
]


@dataclass
class ParsedAddress:
    address_line1: str = ""
    city: str = ""
    state: str = ""
    pincode: str = ""
    country: str = ""
    full_address: str = ""

    def as_dict(self) -> dict:
        return {
            "address_line1": self.address_line1,
            "city": self.city,
            "state": self.state,
            "pincode": self.pincode,
            "country": self.country,
            "full_address": self.full_address,
        }


@dataclass
class ExtractionResult:
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    addresses: list[str] = field(default_factory=list)
    parsed_address: Optional[dict] = None
    source: str = "html"
    is_fallback: bool = False
    fallback_fields: list[str] = field(default_factory=list)
    direct_person_found: bool = False
    direct_person_email_found: bool = False
    direct_person_phone_found: bool = False
    person_name: Optional[str] = None
    person_email: Optional[str] = None
    person_phone: Optional[str] = None
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    fallback_notice: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "emails": self.emails,
            "phones": self.phones,
            "addresses": self.addresses,
            "parsed_address": self.parsed_address,
            "source": self.source,
            "is_fallback": self.is_fallback,
            "fallback_fields": self.fallback_fields,
            "direct_person_found": self.direct_person_found,
            "direct_person_email_found": self.direct_person_email_found,
            "direct_person_phone_found": self.direct_person_phone_found,
            "person_name": self.person_name,
            "person_email": self.person_email,
            "person_phone": self.person_phone,
            "company_email": self.company_email,
            "company_phone": self.company_phone,
            "fallback_notice": self.fallback_notice,
        }


def parse_address_fields(raw_address: str) -> ParsedAddress:
    """
    Parses a raw address string into distinct components:
    address_line1, city, state, pincode, country.
    """
    if not raw_address:
        return ParsedAddress()

    clean_addr = re.sub(r"\s+", " ", raw_address).strip()
    pincode = ""
    country = ""
    city = ""
    state = ""

    # 1. Extract pincode
    pin_match = POSTAL_CODE_RE.search(clean_addr)
    if pin_match:
        pincode = pin_match.group(0).strip()

    # 2. Extract country
    for c in COMMON_COUNTRIES:
        if re.search(rf"\b{re.escape(c)}\b", clean_addr, re.IGNORECASE):
            country = c
            break
    if not country:
        country = "India" if re.search(r"\b\d{6}\b", clean_addr) else ""

    # 3. Extract state
    for s in COMMON_INDIAN_STATES:
        if re.search(rf"\b{re.escape(s)}\b", clean_addr, re.IGNORECASE):
            state = s
            break

    # 4. Extract city
    for c in COMMON_INDIAN_CITIES:
        if re.search(rf"\b{re.escape(c)}\b", clean_addr, re.IGNORECASE):
            city = c
            break

    # 5. Extract address_line1 (everything preceding city/state/pincode/country)
    parts = [p.strip() for p in clean_addr.split(",") if p.strip()]
    if len(parts) >= 2:
        line1_parts = []
        for p in parts:
            p_lower = p.lower()
            if city and city.lower() in p_lower:
                continue
            if state and state.lower() in p_lower:
                continue
            if country and country.lower() in p_lower:
                continue
            if pincode and pincode in p:
                continue
            if any(st.lower() in p_lower for st in COMMON_INDIAN_STATES):
                continue
            line1_parts.append(p)
        address_line1 = ", ".join(line1_parts) if line1_parts else parts[0]
    else:
        address_line1 = clean_addr

    if not city and len(parts) >= 2:
        # Heuristic: the token before country/pincode is often the city
        candidate = parts[-2].strip()
        if not POSTAL_CODE_RE.search(candidate) and len(candidate) < 30 and not any(st.lower() in candidate.lower() for st in COMMON_INDIAN_STATES):
            city = candidate

    return ParsedAddress(
        address_line1=address_line1 or clean_addr,
        city=city,
        state=state,
        pincode=pincode,
        country=country or "India",
        full_address=clean_addr,
    )


def _is_low_value_email(email: str) -> bool:
    if not email or not isinstance(email, str):
        return True
    e = email.lower().strip()
    if "@" not in e:
        return True
    local_part, domain_part = e.split("@", 1)
    
    # Check if extension is an image/asset junk format (e.g. logo@2x.png -> .png)
    ext = domain_part.split(".")[-1].lower() if "." in domain_part else ""
    if ext in JUNK_FILE_EXTENSIONS:
        return True
    
    if any(p in e for p in LOW_VALUE_EMAIL_PATTERNS):
        return True
    return False


def _decode_cloudflare_email(cfemail: str) -> str | None:
    """Decodes Cloudflare's /cdn-cgi/l/email-protection hex-encoded emails."""
    try:
        r = int(cfemail[:2], 16)
        email = "".join(
            chr(int(cfemail[i:i + 2], 16) ^ r)
            for i in range(2, len(cfemail), 2)
        )
        return email if not _is_low_value_email(email) else None
    except Exception:
        return None


def filter_emails_to_domain(emails: list[str], company_domain: str) -> list[str]:
    """
    Keep only emails on the company's own domain (or a subdomain of it).
    Drops third-party registrar/trustee emails found on investor pages.
    """
    company_domain = company_domain.lower()
    if company_domain.startswith("www."):
        company_domain = company_domain[4:]
    kept = []
    for e in emails:
        try:
            email_domain = e.split("@", 1)[1].lower()
        except IndexError:
            continue
        if email_domain == company_domain or email_domain.endswith("." + company_domain):
            kept.append(e)
    return kept


def pick_primary_email(emails: list[str]) -> str | None:
    """
    From a list of emails, pick the single best general-contact address:
    prefer generic prefixes (info@, contact@, enquiry@, connect@, etc.),
    then shortest local-part, else first found.
    """
    if not emails:
        return None
    for prefix in GENERIC_EMAIL_PREFIXES:
        for e in emails:
            if e.split("@", 1)[0].lower() == prefix:
                return e
    for prefix in GENERIC_EMAIL_PREFIXES:
        for e in emails:
            if prefix in e.split("@", 1)[0].lower():
                return e
    return min(emails, key=lambda e: len(e.split("@", 1)[0]))


def pick_primary_phone(phones: list[str]) -> str | None:
    """Pick a single phone number — simply the first one found."""
    return phones[0] if phones else None


def pick_primary_address(addresses: list[str], company_name: str | None = None) -> str | None:
    """
    Prefer an address mentioning 'registered office' or 'head office';
    otherwise the shortest address with a postal code.
    """
    if not addresses:
        return None
    for a in addresses:
        if "registered office" in a.lower() or "head office" in a.lower() or "corporate office" in a.lower():
            return a

    pool = addresses
    if company_name:
        name_key = company_name.lower().split()[0]
        name_matches = [a for a in pool if name_key in a.lower()]
        if name_matches:
            pool = name_matches

    with_postal = [a for a in pool if POSTAL_CODE_RE.search(a)]
    pool = with_postal or pool
    return min(pool, key=len)


def _person_name_matches(target_name: str, candidate_name: str) -> bool:
    """Checks if a target person's name matches a candidate person's name string."""
    if not target_name or not candidate_name:
        return False
    t_tokens = [t.lower() for t in re.split(r"[\s._\-]+", target_name.strip()) if len(t) >= 2]
    c_tokens = [t.lower() for t in re.split(r"[\s._\-]+", candidate_name.strip()) if len(t) >= 2]
    if not t_tokens or not c_tokens:
        return False
    # Check if all target tokens exist in candidate name tokens or vice-versa
    if all(tok in c_tokens for tok in t_tokens) or all(tok in t_tokens for tok in c_tokens):
        return True
    return False


def find_person_email(person_name: str, emails: list[str]) -> Optional[str]:
    """
    Finds an email specifically matching a target person's name tokens.
    Evaluates tiered name patterns:
    1. Full name combinations: first.last@, first_last@, firstlast@, last.first@
    2. Initial combinations: flast@, f.last@, firstl@, first.l@, lastf@, last.f@
    3. Token containment: all tokens in local-part
    4. First / last name token match (length >= 3 and not generic prefix)
    """
    if not person_name or not emails:
        return None

    tokens = [t.lower() for t in re.split(r"[\s._\-]+", person_name.strip()) if len(t) >= 2]
    if not tokens:
        return None

    first = tokens[0]
    last = tokens[-1] if len(tokens) > 1 else ""
    first_initial = first[0] if first else ""
    last_initial = last[0] if last else ""

    # Tier 1: exact full name combinations
    tier1_patterns = set()
    if last:
        tier1_patterns.update([
            f"{first}.{last}", f"{first}_{last}", f"{first}-{last}", f"{first}{last}",
            f"{last}.{first}", f"{last}_{first}", f"{last}-{first}", f"{last}{first}",
        ])

    # Tier 2: initial combinations
    tier2_patterns = set()
    if last:
        tier2_patterns.update([
            f"{first_initial}.{last}", f"{first_initial}_{last}", f"{first_initial}-{last}", f"{first_initial}{last}",
            f"{first}.{last_initial}", f"{first}_{last_initial}", f"{first}-{last_initial}", f"{first}{last_initial}",
            f"{last}.{first_initial}", f"{last}_{first_initial}", f"{last}-{first_initial}", f"{last}{first_initial}",
        ])

    # Check Tier 1
    for e in emails:
        if _is_low_value_email(e):
            continue
        local = e.split("@", 1)[0].lower()
        if local in tier1_patterns:
            return e

    # Check Tier 2
    for e in emails:
        if _is_low_value_email(e):
            continue
        local = e.split("@", 1)[0].lower()
        if local in tier2_patterns:
            return e

    # Check Tier 3: all tokens in local part
    if len(tokens) >= 2:
        for e in emails:
            if _is_low_value_email(e):
                continue
            local = e.split("@", 1)[0].lower()
            if any(local == prefix for prefix in GENERIC_EMAIL_PREFIXES):
                continue
            if all(tok in local for tok in tokens):
                return e

    # Check Tier 4: first name or last name token
    for e in emails:
        if _is_low_value_email(e):
            continue
        local = e.split("@", 1)[0].lower()
        if any(local == prefix for prefix in GENERIC_EMAIL_PREFIXES):
            continue
        if first and len(first) >= 3 and (local == first or local.startswith(f"{first}.") or local.startswith(f"{first}_")):
            return e
        if last and len(last) >= 3 and (local == last or local.startswith(f"{last}.") or local.startswith(f"{last}_")):
            return e
        if any(tok in local for tok in tokens if len(tok) >= 4):
            return e

    return None


def _extract_from_schema_org(soup: BeautifulSoup, target_person: Optional[str] = None) -> dict:
    """Look for JSON-LD Organization/LocalBusiness/PostalAddress/ContactPoint/Person schema."""
    out = {
        "emails": [], "phones": [], "addresses": [], "structured_addresses": [],
        "person_emails": [], "person_phones": []
    }
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or "{}")
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            # Also handle @graph schema collections
            graph_items = item.get("@graph")
            sub_items = graph_items if isinstance(graph_items, list) else [item]

            for sub in sub_items:
                if not isinstance(sub, dict):
                    continue

                item_type = str(sub.get("@type") or "").lower()
                is_person_type = "person" in item_type
                person_name = str(sub.get("name") or "").strip()
                is_target_person = False
                if target_person and person_name:
                    is_target_person = _person_name_matches(target_person, person_name)

                if "email" in sub:
                    emails = sub["email"] if isinstance(sub["email"], list) else [sub["email"]]
                    for e in emails:
                        if isinstance(e, str) and not _is_low_value_email(e):
                            e_clean = e.strip()
                            out["emails"].append(e_clean)
                            if is_target_person or (is_person_type and not target_person):
                                out["person_emails"].append(e_clean)

                if "telephone" in sub:
                    phones = sub["telephone"] if isinstance(sub["telephone"], list) else [sub["telephone"]]
                    for p in phones:
                        if isinstance(p, str):
                            p_clean = p.strip()
                            out["phones"].append(p_clean)
                            if is_target_person or (is_person_type and not target_person):
                                out["person_phones"].append(p_clean)

                # ContactPoint array
                contact_points = sub.get("contactPoint") or []
                if isinstance(contact_points, dict):
                    contact_points = [contact_points]
                if isinstance(contact_points, list):
                    for cp in contact_points:
                        if isinstance(cp, dict):
                            cp_name = str(cp.get("name") or cp.get("contactType") or "").strip()
                            cp_is_target = target_person and cp_name and _person_name_matches(target_person, cp_name)
                            if cp.get("email") and isinstance(cp["email"], str) and not _is_low_value_email(cp["email"]):
                                e_clean = cp["email"].strip()
                                out["emails"].append(e_clean)
                                if cp_is_target:
                                    out["person_emails"].append(e_clean)
                            if cp.get("telephone") and isinstance(cp["telephone"], str):
                                p_clean = cp["telephone"].strip()
                                out["phones"].append(p_clean)
                                if cp_is_target:
                                    out["person_phones"].append(p_clean)

                addr = sub.get("address")
                if isinstance(addr, dict):
                    street = str(addr.get("streetAddress") or "").strip()
                    locality = str(addr.get("addressLocality") or "").strip()
                    region = str(addr.get("addressRegion") or "").strip()
                    postal = str(addr.get("postalCode") or "").strip()
                    country = str(addr.get("addressCountry") or "").strip()
                    parts = [street, locality, region, postal, country]
                    joined = ", ".join(p for p in parts if p)
                    if joined:
                        out["addresses"].append(joined)
                        out["structured_addresses"].append(ParsedAddress(
                            address_line1=street or joined,
                            city=locality or region,
                            pincode=postal,
                            country=country or "India",
                            full_address=joined,
                        ))
                elif isinstance(addr, str) and addr.strip():
                    out["addresses"].append(addr.strip())
                    out["structured_addresses"].append(parse_address_fields(addr.strip()))
    return out


def _extract_from_microdata(soup: BeautifulSoup, target_person: Optional[str] = None) -> dict:
    """Extract contact and postal details from HTML5 Microdata."""
    out = {
        "emails": [], "phones": [], "addresses": [], "structured_addresses": [],
        "person_emails": [], "person_phones": []
    }
    
    # 1. Microdata emails
    for tag in soup.select("[itemprop='email']"):
        val = tag.get("content") or tag.get_text(" ", strip=True)
        if val and "@" in val and not _is_low_value_email(val):
            out["emails"].append(val.strip())

    # 2. Microdata phones
    for tag in soup.select("[itemprop='telephone'], [itemprop='phone']"):
        val = tag.get("content") or tag.get_text(" ", strip=True)
        if val:
            out["phones"].append(val.strip())

    # 3. Microdata Person objects
    for tag in soup.select("[itemtype*='Person']"):
        name_el = tag.select_one("[itemprop='name']")
        name_val = name_el.get_text(" ", strip=True) if name_el else ""
        is_target = target_person and name_val and _person_name_matches(target_person, name_val)
        
        email_el = tag.select_one("[itemprop='email']")
        if email_el:
            e_val = email_el.get("content") or email_el.get("href", "").replace("mailto:", "") or email_el.get_text(" ", strip=True)
            if e_val and "@" in e_val and not _is_low_value_email(e_val):
                out["emails"].append(e_val.strip())
                if is_target:
                    out["person_emails"].append(e_val.strip())
        
        phone_el = tag.select_one("[itemprop='telephone'], [itemprop='phone']")
        if phone_el:
            p_val = phone_el.get("content") or phone_el.get("href", "").replace("tel:", "") or phone_el.get_text(" ", strip=True)
            if p_val:
                out["phones"].append(p_val.strip())
                if is_target:
                    out["person_phones"].append(p_val.strip())

    # 4. Microdata structured address
    for tag in soup.select("[itemprop='address'], [itemtype*='PostalAddress']"):
        street_el = tag.select_one("[itemprop='streetAddress']")
        city_el = tag.select_one("[itemprop='addressLocality']")
        region_el = tag.select_one("[itemprop='addressRegion']")
        pin_el = tag.select_one("[itemprop='postalCode']")
        country_el = tag.select_one("[itemprop='addressCountry']")

        street = street_el.get_text(" ", strip=True) if street_el else ""
        city = city_el.get_text(" ", strip=True) if city_el else (region_el.get_text(" ", strip=True) if region_el else "")
        pincode = pin_el.get_text(" ", strip=True) if pin_el else ""
        country = country_el.get_text(" ", strip=True) if country_el else ""

        full = html_lib.unescape(tag.get_text(" ", strip=True))
        if 15 < len(full) < 400:
            out["addresses"].append(full)
            out["structured_addresses"].append(ParsedAddress(
                address_line1=street or full,
                city=city,
                pincode=pincode,
                country=country or "India",
                full_address=full,
            ))

    return out


def _extract_person_contacts_from_html_context(
    soup: BeautifulSoup,
    target_person: str,
    default_region: str = "IN",
) -> tuple[list[str], list[str]]:
    """
    Scans HTML for contextual mentions of target_person and extracts emails/phones
    located within the same container / DOM block.
    """
    if not target_person:
        return [], []

    tokens = [t.lower() for t in re.split(r"[\s._\-]+", target_person.strip()) if len(t) >= 2]
    if not tokens:
        return [], []

    person_emails = []
    person_phones = []

    # Search for text elements mentioning the person's name
    pattern = re.compile(rf"\b{re.escape(tokens[0])}\b", re.IGNORECASE)
    for el in soup.find_all(string=pattern):
        text_content = str(el)
        if not _person_name_matches(target_person, text_content):
            # Check if parent or container contains the full name
            parent = el.parent
            container = parent
            found_container = False
            for _ in range(4):
                if container and container.name not in ["body", "html", "[document]"]:
                    if _person_name_matches(target_person, container.get_text(" ", strip=True)):
                        found_container = True
                        break
                    container = container.parent
                else:
                    break
            if not found_container:
                continue
        else:
            container = el.parent

        if not container:
            continue

        # Look for mailto: and tel: links in this container
        for a in container.find_all("a", href=True):
            href = a["href"].strip()
            if href.lower().startswith("mailto:"):
                raw_addr = href.split(":", 1)[1].split("?")[0].strip()
                decoded = urllib.parse.unquote(html_lib.unescape(raw_addr))
                if decoded and not _is_low_value_email(decoded):
                    person_emails.append(decoded)
            elif href.lower().startswith("tel:"):
                raw_num = href.split(":", 1)[1].strip()
                decoded = urllib.parse.unquote(html_lib.unescape(raw_num))
                if decoded:
                    person_phones.append(_normalize_phone(decoded, default_region))

        # Look for regex emails and phones in container text
        c_text = container.get_text(" ", strip=True)
        if len(c_text) < 1000:
            for em in _extract_emails_from_text(c_text):
                person_emails.append(em)
            for ph in _extract_phones_from_text(c_text, default_region=default_region):
                person_phones.append(ph)

    return list(dict.fromkeys(person_emails)), list(dict.fromkeys(person_phones))


def _extract_emails_from_text(text: str) -> list[str]:
    clean = urllib.parse.unquote(html_lib.unescape(text))
    found = set(EMAIL_RE.findall(clean))
    for m in OBFUSCATED_EMAIL_RE.finditer(clean):
        found.add(f"{m.group(1)}@{m.group(2)}.{m.group(3)}")
    return [e.strip() for e in found if not _is_low_value_email(e)]


def _normalize_phone(raw: str, default_region: str = "IN") -> str:
    """Best-effort validation and international formatting of phone numbers."""
    try:
        clean = re.sub(r"[^\d\+]", "", raw)
        parsed = phonenumbers.parse(clean, default_region)
        if phonenumbers.is_valid_number(parsed) or phonenumbers.is_possible_number(parsed):
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.INTERNATIONAL)
    except Exception:
        pass
    # Toll-free regex fallback formatting (e.g. 1800 209 7979)
    if re.match(r"^(1800|1860)[\s\-]?\d{3}[\s\-]?\d{3,4}$", raw.strip()):
        return raw.strip()
    return raw.strip()


def _extract_phones_from_text(text: str, default_region: str = "IN") -> list[str]:
    """Uses Google's libphonenumber + regex matching for toll-free numbers."""
    clean = html_lib.unescape(text)
    results = set()

    for match in phonenumbers.PhoneNumberMatcher(clean, default_region):
        formatted = phonenumbers.format_number(
            match.number, phonenumbers.PhoneNumberFormat.INTERNATIONAL
        )
        results.add(formatted)

    # Toll-free regex (e.g. 1800 209 7979 / 1860 123 4567)
    toll_free_matches = re.findall(r"\b(?:1800|1860)[\s\-]?\d{3}[\s\-]?\d{3,4}\b", clean)
    for tf in toll_free_matches:
        results.add(tf.strip())

    return sorted(results)


def _extract_addresses_from_text(soup: BeautifulSoup) -> list[str]:
    """
    Heuristic address detection: checks <address> tags, HTML5 microdata,
    and text blocks containing postal code + address keywords.
    """
    addresses = []

    # 1. <address> tags
    for tag in soup.find_all("address"):
        txt = html_lib.unescape(tag.get_text(" ", strip=True))
        if txt and 15 < len(txt) < 350:
            addresses.append(txt)

    if addresses:
        return list(dict.fromkeys(addresses))

    # 2. Text scanning
    candidates = []
    for tag in soup.find_all(["p", "div", "li", "span", "td"]):
        txt = html_lib.unescape(tag.get_text(" ", strip=True))
        if not txt or len(txt) > 300 or len(txt) < 15:
            continue
        lower = txt.lower()
        has_keyword = any(k in lower for k in ADDRESS_KEYWORDS)
        has_postal = bool(POSTAL_CODE_RE.search(txt))
        if has_keyword and has_postal:
            candidates.append(txt)

    seen = set()
    deduped = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            deduped.append(c)
    return deduped[:5]


def _check_person_contact_match(person_name: str, emails: list[str]) -> bool:
    """Checks if any extracted email matches the named individual's name tokens."""
    return find_person_email(person_name, emails) is not None


def extract_contact_info(
    html: str,
    target_person: Optional[str] = None,
    company_domain: str = "",
    default_region: str = "IN",
) -> ExtractionResult:
    """
    Main entry point. Extracts emails, phones, and addresses with multi-level priority:
    schema.org JSON-LD > HTML5 Microdata > mailto/tel links > Cloudflare obfuscation > visible text.
    Evaluates person vs corporate fallback and sets is_fallback and fallback_fields metadata.
    """
    soup = BeautifulSoup(html, "lxml")
    target_person_clean = (target_person or "").strip() or None
    result = ExtractionResult(person_name=target_person_clean)

    # 1. schema.org JSON-LD
    schema_data = _extract_from_schema_org(soup, target_person=target_person_clean)
    if any(schema_data["emails"] or schema_data["phones"] or schema_data["addresses"]):
        result.source = "schema.org"

    # 2. HTML5 Microdata
    microdata = _extract_from_microdata(soup, target_person=target_person_clean)
    if any(microdata["emails"] or microdata["phones"] or microdata["addresses"]) and result.source == "html":
        result.source = "microdata"

    # 3. Contextual DOM proximity search for person
    context_person_emails, context_person_phones = _extract_person_contacts_from_html_context(
        soup, target_person=target_person_clean, default_region=default_region
    ) if target_person_clean else ([], [])

    # 4. mailto: / tel: links
    mailto_emails = []
    tel_phones = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            raw_addr = href.split(":", 1)[1].split("?")[0].strip()
            decoded_addr = urllib.parse.unquote(html_lib.unescape(raw_addr))
            if decoded_addr and not _is_low_value_email(decoded_addr):
                mailto_emails.append(decoded_addr)
        elif href.lower().startswith("tel:"):
            raw_tel = href.split(":", 1)[1].split("?")[0].strip()
            decoded_tel = urllib.parse.unquote(html_lib.unescape(raw_tel))
            if decoded_tel:
                tel_phones.append(decoded_tel)
        elif "/cdn-cgi/l/email-protection#" in href:
            cf_hex = href.split("#", 1)[1]
            decoded = _decode_cloudflare_email(cf_hex)
            if decoded:
                mailto_emails.append(decoded)

    # 5. Cloudflare-protected data attributes
    cf_emails = []
    for tag in soup.select("[data-cfemail]"):
        decoded = _decode_cloudflare_email(tag.get("data-cfemail", ""))
        if decoded:
            cf_emails.append(decoded)

    # 6. Visible text
    visible_text = soup.get_text(" ", strip=True)
    text_emails = _extract_emails_from_text(visible_text)
    text_phones = _extract_phones_from_text(visible_text, default_region=default_region)

    # 7. Addresses
    text_addresses = _extract_addresses_from_text(soup)
    all_addresses = schema_data["addresses"] + microdata["addresses"] + text_addresses

    # Merge & normalize
    all_emails = schema_data["emails"] + microdata["emails"] + mailto_emails + cf_emails + text_emails
    all_phones = [
        _normalize_phone(p, default_region) for p in (schema_data["phones"] + microdata["phones"] + tel_phones)
    ] + text_phones

    def dedup(seq):
        seen = set()
        out = []
        for x in seq:
            key = str(x).lower().strip()
            if key not in seen:
                seen.add(key)
                out.append(x.strip() if isinstance(x, str) else x)
        return out

    result.emails = dedup(all_emails)
    result.phones = dedup(all_phones)
    result.addresses = dedup(all_addresses)

    if result.source == "html" and (mailto_emails or tel_phones):
        result.source = "mailto/tel"

    # Structured address resolution
    all_struct_addrs = schema_data["structured_addresses"] + microdata["structured_addresses"]
    if all_struct_addrs:
        result.parsed_address = all_struct_addrs[0].as_dict()
    elif result.addresses:
        primary_addr_str = pick_primary_address(result.addresses)
        if primary_addr_str:
            result.parsed_address = parse_address_fields(primary_addr_str).as_dict()

    # Company contact defaults
    domain_emails = filter_emails_to_domain(result.emails, company_domain) or result.emails
    company_email = pick_primary_email(domain_emails)
    company_phone = pick_primary_phone(result.phones)
    result.company_email = company_email
    result.company_phone = company_phone

    # Condition 1 vs Condition 2 Evaluation:
    if target_person_clean:
        # Check person emails from schema, microdata, context, and email tokens
        all_candidate_person_emails = schema_data["person_emails"] + microdata["person_emails"] + context_person_emails
        matched_email = None
        if all_candidate_person_emails:
            matched_email = all_candidate_person_emails[0]
        else:
            matched_email = find_person_email(target_person_clean, domain_emails) or find_person_email(target_person_clean, result.emails)

        all_candidate_person_phones = schema_data["person_phones"] + microdata["person_phones"] + context_person_phones
        matched_phone = None
        if all_candidate_person_phones:
            matched_phone = _normalize_phone(all_candidate_person_phones[0], default_region)

        result.person_email = matched_email
        result.person_phone = matched_phone
        result.direct_person_email_found = bool(matched_email)
        result.direct_person_phone_found = bool(matched_phone)
        result.direct_person_found = bool(matched_email or matched_phone)

        if not result.direct_person_found:
            # Fallback to company information and flag notice
            result.is_fallback = True
            fallback_fields = []
            if company_email or result.emails:
                fallback_fields.append("email")
            if company_phone or result.phones:
                fallback_fields.append("phone")
            if result.addresses or result.parsed_address:
                fallback_fields.append("address")
            result.fallback_fields = fallback_fields
            result.fallback_notice = (
                f"Note: I couldn't find the lead person's information ({target_person_clean}) on the website, "
                f"so using company's contact information ({company_email or 'no email'} / {company_phone or 'no phone'})."
            )
        else:
            result.is_fallback = False
            result.fallback_fields = []
            result.fallback_notice = None
    else:
        # Condition 2: No person name given, directly use company information
        result.direct_person_found = False
        result.is_fallback = False
        result.fallback_fields = []
        result.fallback_notice = None

    return result