#!/usr/bin/env python3
"""
seed_erp.py

Standalone data-seeding script for an ERPNext instance fronted by a
custom "Sales App" that exposes whitelisted REST endpoints:

    sales_app.api.lead.create_lead
    sales_app.api.customer.create_customer
    sales_app.api.opportunity.create_opportunity
    sales_app.api.quotation.create_quotation
    sales_app.api.sales_order.create_sales_order

This script creates a realistic, INTERLINKED chain of business records:

    Item (master data)
      -> Lead -> Customer -> Opportunity -> Quotation -> Sales Order

Item master records are a prerequisite: ERPNext's Quotation/Sales Order
validation rejects any item_code that doesn't already exist as an Item
doctype record. Since there's no custom sales_app endpoint for creating
items, this script creates them directly via ERPNext's generic REST API
(/api/resource/Item) before any quotation or sales order is created.

This script does NOT touch the database directly and does NOT use
`bench` — it only talks to ERPNext over HTTP, exactly the way any
external system would, authenticating with an API key/secret token.

Usage:
    pip install requests faker
    python seed_erp.py
"""

import logging
import random
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from faker import Faker
except ImportError:
    print("Missing dependency 'faker'. Install it with: pip install faker")
    sys.exit(1)


# =====================================================================
# Configuration
# =====================================================================

ERP_URL = "http://127.0.0.1:8000"
API_KEY = "7ea330177bdd90c"
API_SECRET = "ba8ef965a539b22"

LEAD_ENDPOINT = "sales_app.api.lead.create_lead"
CUSTOMER_ENDPOINT = "sales_app.api.customer.create_customer"
OPPORTUNITY_ENDPOINT = "sales_app.api.opportunity.create_opportunity"
QUOTATION_ENDPOINT = "sales_app.api.quotation.create_quotation"
SALES_ORDER_ENDPOINT = "sales_app.api.sales_order.create_sales_order"

# No custom sales_app endpoint exists for Items, so these go straight to
# ERPNext's generic doctype REST resource instead of /api/method/<...>.
ITEM_RESOURCE_PATH = "api/resource/Item"

RECORD_COUNT = 100
REQUEST_TIMEOUT_SECONDS = 20
MAX_RETRIES = 3
RETRY_BACKOFF_FACTOR = 1.5
RETRY_STATUS_FORCELIST = (429, 500, 502, 503, 504)

fake = Faker("en_IN")


# =====================================================================
# Colored logging
# =====================================================================

class ColorCodes:
    RESET = "\033[0m"
    GREY = "\033[90m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"


class ColorFormatter(logging.Formatter):
    LEVEL_COLORS = {
        logging.DEBUG: ColorCodes.GREY,
        logging.INFO: ColorCodes.CYAN,
        logging.WARNING: ColorCodes.YELLOW,
        logging.ERROR: ColorCodes.RED,
        logging.CRITICAL: ColorCodes.RED + ColorCodes.BOLD,
    }

    def format(self, record: logging.LogRecord) -> str:
        color = self.LEVEL_COLORS.get(record.levelno, ColorCodes.RESET)
        message = super().format(record)
        return f"{color}{message}{ColorCodes.RESET}"


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("seed-erp")
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(ColorFormatter("%(asctime)s | %(levelname)-8s | %(message)s", "%H:%M:%S"))
    logger.addHandler(handler)
    logger.propagate = False
    return logger


logger = setup_logging()


# =====================================================================
# HTTP session with retry
# =====================================================================

def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "Authorization": f"token {API_KEY}:{API_SECRET}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })

    retry_strategy = Retry(
        total=MAX_RETRIES,
        backoff_factor=RETRY_BACKOFF_FACTOR,
        status_forcelist=RETRY_STATUS_FORCELIST,
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


SESSION = build_session()


def post_endpoint(
    endpoint: str,
    payload: Dict[str, Any],
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """POST to /api/method/<endpoint>. Returns (success, message_dict, error_str).

    urllib3's Retry handles transient network/5xx retries automatically.
    Any remaining failure (network error, 4xx, malformed JSON) is caught
    here and reported back rather than raised, so the caller can keep
    the seeding loop going and just count the failure.
    """
    url = f"{ERP_URL.rstrip('/')}/api/method/{endpoint}"
    clean_payload = {k: v for k, v in payload.items() if v is not None}

    try:
        response = SESSION.post(url, json=clean_payload, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        return False, None, f"network error calling {endpoint}: {exc}"

    if response.status_code >= 400:
        snippet = response.text[:300].replace("\n", " ")
        return False, None, f"HTTP {response.status_code} from {endpoint}: {snippet}"

    try:
        body = response.json()
    except ValueError:
        return False, None, f"non-JSON response from {endpoint}: {response.text[:300]}"

    message = body.get("message", body)
    if not isinstance(message, dict):
        message = {"raw": message}

    return True, message, None


def post_resource(
    resource_path: str,
    payload: Dict[str, Any],
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """POST to a generic ERPNext REST resource: /api/resource/<Doctype>.

    Used for Item master creation, since no custom sales_app endpoint
    exposes item creation. Unlike post_endpoint(), the created document
    comes back under the top-level "data" key rather than "message".
    A 409 (DuplicateEntryError) is treated as a soft success: if the
    item_code already exists (e.g. from a previous run of this script),
    we just reuse it instead of failing the whole seed run.
    """
    url = f"{ERP_URL.rstrip('/')}/{resource_path}"
    clean_payload = {k: v for k, v in payload.items() if v is not None}

    try:
        response = SESSION.post(url, json=clean_payload, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        return False, None, f"network error calling {resource_path}: {exc}"

    if response.status_code == 409:
        # Item already exists from a prior run — not a real failure.
        return True, {"data": clean_payload, "already_existed": True}, None

    if response.status_code >= 400:
        snippet = response.text[:300].replace("\n", " ")
        return False, None, f"HTTP {response.status_code} from {resource_path}: {snippet}"

    try:
        body = response.json()
    except ValueError:
        return False, None, f"non-JSON response from {resource_path}: {response.text[:300]}"

    data = body.get("data", body)
    if not isinstance(data, dict):
        data = {"raw": data}

    return True, data, None


# =====================================================================
# Reference data pools
# =====================================================================

INDIAN_STATES_CITIES = [
    ("Maharashtra", ["Mumbai", "Pune", "Nagpur", "Nashik"]),
    ("Karnataka", ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi"]),
    ("Delhi", ["New Delhi"]),
    ("Tamil Nadu", ["Chennai", "Coimbatore", "Madurai", "Salem"]),
    ("Telangana", ["Hyderabad", "Warangal"]),
    ("Gujarat", ["Ahmedabad", "Surat", "Vadodara", "Rajkot"]),
    ("West Bengal", ["Kolkata", "Howrah", "Siliguri"]),
    ("Uttar Pradesh", ["Lucknow", "Kanpur", "Noida", "Ghaziabad"]),
    ("Rajasthan", ["Jaipur", "Jodhpur", "Udaipur"]),
    ("Punjab", ["Chandigarh", "Ludhiana", "Amritsar"]),
    ("Kerala", ["Kochi", "Thiruvananthapuram", "Kozhikode"]),
    ("Haryana", ["Gurugram", "Faridabad", "Panipat"]),
]

STATE_GST_CODES = {
    "Maharashtra": "27", "Karnataka": "29", "Delhi": "07", "Tamil Nadu": "33",
    "Telangana": "36", "Gujarat": "24", "West Bengal": "19", "Uttar Pradesh": "09",
    "Rajasthan": "08", "Punjab": "03", "Kerala": "32", "Haryana": "06",
}

INDUSTRIES = [
    "Information Technology", "Manufacturing", "Textiles", "Pharmaceuticals",
    "Agriculture", "Retail", "Logistics", "Construction", "Education",
    "Banking & Finance", "Automotive", "FMCG", "Real Estate", "Hospitality",
]

LEAD_SOURCES = [
    "Website", "Cold Call", "Existing Customer", "Reference", "Advertisement",
    "Trade Fair", "Exhibition", "Supplier Reference", "Mass Mailing",
    "Customer's Vendor", "Campaign", "Walk In",
]

LEAD_STATUSES = ["Lead", "Open", "Contacted", "Replied", "Opportunity", "Converted"]

TERRITORIES = [
    "India", "Maharashtra", "Karnataka", "Delhi NCR", "Tamil Nadu", "Gujarat",
    "West Bengal", "Rest Of India",
]

CUSTOMER_GROUPS = ["Individual", "Commercial", "Government", "Non Profit", "Retail", "Wholesale"]
CUSTOMER_TYPES = ["Company", "Individual", "Partnership"]

PAYMENT_TERMS = [
    "Net 15", "Net 30", "Net 45", "Net 60", "50% Advance", "100% Advance",
    "Cash on Delivery",
]

OPPORTUNITY_STAGES = [
    "Prospecting", "Qualification", "Needs Analysis", "Discussion",
    "Proposal/Price Quote", "Negotiation", "Ready to Close",
]

QUOTATION_STATUSES = ["Draft", "Open", "Replied", "Ordered", "Lost", "Cancelled"]

PRIORITIES = ["Low", "Medium", "High", "Urgent"]

# item_group and stock_uom are required by ERPNext's Item doctype, so
# each catalog entry carries enough info to create the master record,
# not just to reference it later.
#
# This list matches exactly the 16 Items confirmed to already exist in
# the target ERPNext instance (item_group/uom pulled from the live Item
# list). The 4 codes that previously failed with LinkValidationError
# (ITM-ELEC-010, ITM-PKG-061, ITM-AGRI-080, ITM-FMCG-090 — all due to a
# UOM that doesn't exist as a UOM master record: Roll/Bag/Tin) have been
# dropped rather than fixed, so this script no longer depends on any
# non-default UOM existing.
PRODUCT_CATALOG = [
    ("ITM-STEEL-001", "Cold Rolled Steel Sheet 2mm", 4200.00, "Raw Material", "Nos"),
    ("ITM-STEEL-002", "Hot Rolled Steel Coil", 3850.00, "Raw Material", "Kg"),
    ("ITM-ELEC-011", "LED Panel Light 40W", 640.00, "Products", "Nos"),
    ("ITM-TEXT-020", "Cotton Fabric Roll (per meter)", 180.00, "Raw Material", "Meter"),
    ("ITM-TEXT-021", "Polyester Blend Fabric (per meter)", 145.00, "Raw Material", "Meter"),
    ("ITM-PHARMA-030", "Paracetamol 500mg (1000 tablets)", 950.00, "Products", "Box"),
    ("ITM-PHARMA-031", "Surgical Gloves (box of 100)", 480.00, "Products", "Box"),
    ("ITM-IT-040", "Business Laptop 15.6-inch", 52000.00, "Products", "Nos"),
    ("ITM-IT-041", "24-inch LED Monitor", 8500.00, "Products", "Nos"),
    ("ITM-IT-042", "Wireless Keyboard & Mouse Combo", 1450.00, "Products", "Set"),
    ("ITM-FURN-050", "Office Chair (Ergonomic)", 6200.00, "Products", "Nos"),
    ("ITM-FURN-051", "Office Desk (4ft)", 7800.00, "Products", "Nos"),
    ("ITM-PKG-060", "Corrugated Box (Medium)", 35.00, "Consumable", "Nos"),
    ("ITM-AUTO-070", "Automotive Brake Pad Set", 2150.00, "Products", "Set"),
    ("ITM-AUTO-071", "Engine Oil 4L Can", 1800.00, "Products", "Nos"),
    ("ITM-AGRI-081", "Drip Irrigation Kit", 3400.00, "Products", "Set"),
]


# =====================================================================
# Data classes for created record references
# =====================================================================

@dataclass
class CreatedLead:
    lead_id: str
    name: str
    company: str
    email: str


@dataclass
class CreatedCustomer:
    customer_id: str
    customer_name: str
    territory: str
    lead_id: Optional[str] = None


@dataclass
class CreatedOpportunity:
    opportunity_id: str
    lead_id: Optional[str]
    customer_id: Optional[str]


@dataclass
class CreatedQuotation:
    quotation_id: str
    customer_id: str
    grand_total: float


@dataclass
class SeedResults:
    leads: List[CreatedLead] = field(default_factory=list)
    customers: List[CreatedCustomer] = field(default_factory=list)
    opportunities: List[CreatedOpportunity] = field(default_factory=list)
    quotations: List[CreatedQuotation] = field(default_factory=list)
    sales_orders: List[str] = field(default_factory=list)
    ready_item_codes: List[str] = field(default_factory=list)

    lead_failures: int = 0
    customer_failures: int = 0
    opportunity_failures: int = 0
    quotation_failures: int = 0
    sales_order_failures: int = 0
    item_failures: int = 0


# =====================================================================
# Fake data generators
# =====================================================================

def random_state_city() -> Tuple[str, str]:
    state, cities = random.choice(INDIAN_STATES_CITIES)
    return state, random.choice(cities)


def fake_gst_number(state: str) -> str:
    state_code = STATE_GST_CODES.get(state, "27")
    pan_like = fake.bothify(text="?????####?").upper()
    entity_code = random.randint(1, 9)
    return f"{state_code}{pan_like}{entity_code}Z{random.choice('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"


def fake_mobile_number() -> str:
    return f"+91{random.choice('6789')}{random.randint(10**8, 10**9 - 1)}"


def fake_pincode() -> str:
    return f"{random.randint(100000, 999999)}"


def random_date_last_year() -> date:
    days_back = random.randint(0, 365)
    return date.today() - timedelta(days=days_back)


def random_future_date(min_days: int = 7, max_days: int = 90) -> date:
    return date.today() + timedelta(days=random.randint(min_days, max_days))


def build_item_payload(item_code: str, description: str, rate: float, item_group: str, uom: str) -> Dict[str, Any]:
    return {
        "item_code": item_code,
        "item_name": description,
        "description": description,
        "item_group": item_group,
        "stock_uom": uom,
        "is_stock_item": 1,
        "standard_rate": rate,
        "valuation_rate": round(rate * 0.85, 2),
    }


def build_lead_payload() -> Tuple[Dict[str, Any], str]:
    person_name = fake.name()
    company = fake.company()
    state, city = random_state_city()
    payload = {
        "name": person_name,
        "email": fake.company_email(),
        "phone": fake_mobile_number(),
        "company": company,
        "product_interested": random.choice(PRODUCT_CATALOG)[1],
        "quantity": str(random.randint(1, 500)),
        "notes": (
            f"Sourced via {random.choice(LEAD_SOURCES)}. Based in {city}, {state}. "
            f"Industry: {random.choice(INDUSTRIES)}. Status: {random.choice(LEAD_STATUSES)}. "
            f"Territory: {random.choice(TERRITORIES)}. Ref: {uuid.uuid4().hex[:8]}."
        ),
    }
    return payload, company


def build_customer_payload(lead: Optional[CreatedLead]) -> Tuple[Dict[str, Any], str]:
    state, city = random_state_city()
    customer_name = lead.company if lead else fake.company()
    payload = {
        "customer_name": customer_name,
        "customer_type": random.choice(CUSTOMER_TYPES),
        "territory": random.choice(TERRITORIES),
        "email_id": fake.company_email(),
        "mobile_no": fake_mobile_number(),
        "lead_id": lead.lead_id if lead else None,
    }
    return payload, state


def build_opportunity_payload(lead: Optional[CreatedLead]) -> Dict[str, Any]:
    expected_revenue = round(random.uniform(25000, 2500000), 2)
    close_date = random_future_date(15, 120)
    return {
        "lead": lead.lead_id if lead else None,
        "opportunity_name": f"{(lead.company if lead else fake.company())} - {random.choice(PRODUCT_CATALOG)[1]}",
        "expected_revenue": expected_revenue,
        "stage": random.choice(OPPORTUNITY_STAGES),
        "close_date": close_date.isoformat(),
    }


def build_quotation_items(available_item_codes: List[str]) -> Tuple[List[Dict[str, Any]], float]:
    catalog_by_code = {code: (code, desc, rate) for code, desc, rate, *_ in PRODUCT_CATALOG}
    usable_codes = [c for c in available_item_codes if c in catalog_by_code] or list(catalog_by_code.keys())

    item_count = random.randint(2, 6)
    chosen_codes = random.sample(usable_codes, k=min(item_count, len(usable_codes)))

    items = []
    grand_total = 0.0
    for item_code in chosen_codes:
        _, description, base_rate = catalog_by_code[item_code]
        qty = random.randint(1, 100)
        rate = round(base_rate * random.uniform(0.9, 1.15), 2)
        amount = round(qty * rate, 2)
        grand_total += amount
        items.append({
            "item_code": item_code,
            "description": description,
            "qty": qty,
            "rate": rate,
        })
    return items, round(grand_total, 2)


def build_quotation_payload(
    customer: CreatedCustomer, available_item_codes: List[str]
) -> Tuple[Dict[str, Any], float]:
    items, grand_total = build_quotation_items(available_item_codes)
    valid_till = random_future_date(15, 60)
    payload = {
        "customer": customer.customer_id,
        "items": items,
        "valid_till": valid_till.isoformat(),
        "note": (
            f"Payment terms: {random.choice(PAYMENT_TERMS)}. "
            f"Status: {random.choice(QUOTATION_STATUSES)}. "
            f"Prepared for {customer.customer_name}. Ref: {uuid.uuid4().hex[:8]}."
        ),
    }
    return payload, grand_total


def build_sales_order_payload(
    customer: CreatedCustomer,
    quotation: Optional[CreatedQuotation],
    available_item_codes: List[str],
) -> Dict[str, Any]:
    items, _ = build_quotation_items(available_item_codes)
    delivery_date = random_future_date(3, 45)
    quotation_ref = f" (from {quotation.quotation_id})" if quotation else ""
    return {
        "customer": customer.customer_id,
        "items": items,
        "delivery_date": delivery_date.isoformat(),
        "priority": random.choice(PRIORITIES),
        "note": (
            f"Order for {customer.customer_name}{quotation_ref}. "
            f"Payment terms: {random.choice(PAYMENT_TERMS)}. "
            f"Ref: {uuid.uuid4().hex[:8]}."
        ),
        "submit": True,
        "create_work_order": False,
    }


# =====================================================================
# Extraction helpers (ERPNext custom endpoints may name the id field
# differently, so try a few common keys before giving up)
# =====================================================================

def extract_id(message: Dict[str, Any], *candidate_keys: str) -> Optional[str]:
    for key in candidate_keys:
        value = message.get(key)
        if value:
            return str(value)
    return None


# =====================================================================
# Progress printer
# =====================================================================

def print_progress(label: str, current: int, total: int) -> None:
    bar_width = 30
    filled = int(bar_width * current / total)
    bar = "#" * filled + "-" * (bar_width - filled)
    sys.stdout.write(f"\r{ColorCodes.CYAN}{label:<14} [{bar}] {current}/{total}{ColorCodes.RESET}")
    sys.stdout.flush()
    if current == total:
        sys.stdout.write("\n")


# =====================================================================
# Seeding stages
# =====================================================================

def seed_items(results: SeedResults) -> None:
    """Creates every catalog Item as a master record via the generic
    ERPNext REST resource (no sales_app endpoint exists for this).
    Must run before quotations/sales orders, since those reference
    item_code and ERPNext validates that the Item already exists.
    """
    total = len(PRODUCT_CATALOG)
    logger.info("Creating %d Items (master data)...", total)
    for i, (item_code, description, rate, item_group, uom) in enumerate(PRODUCT_CATALOG, start=1):
        payload = build_item_payload(item_code, description, rate, item_group, uom)
        success, data, error = post_resource(ITEM_RESOURCE_PATH, payload)
        if success:
            results.ready_item_codes.append(item_code)
        else:
            results.item_failures += 1
            logger.error("Failed to create item '%s': %s", item_code, error)
        print_progress("Items", i, total)


def seed_leads(results: SeedResults, count: int) -> None:
    logger.info("Creating %d Leads...", count)
    for i in range(1, count + 1):
        payload, company = build_lead_payload()
        success, message, error = post_endpoint(LEAD_ENDPOINT, payload)
        if success and message:
            lead_id = extract_id(message, "name", "lead", "lead_id")
            if lead_id:
                results.leads.append(CreatedLead(
                    lead_id=lead_id,
                    name=payload["name"],
                    company=company,
                    email=payload["email"],
                ))
            else:
                results.lead_failures += 1
                logger.warning("Lead created but no id found in response: %s", message)
        else:
            results.lead_failures += 1
            logger.error("Failed to create lead #%d: %s", i, error)
        print_progress("Leads", i, count)


def seed_customers(results: SeedResults, count: int) -> None:
    logger.info("Creating %d Customers...", count)
    for i in range(1, count + 1):
        lead = results.leads[i - 1] if i - 1 < len(results.leads) else (
            random.choice(results.leads) if results.leads else None
        )
        payload, state = build_customer_payload(lead)
        success, message, error = post_endpoint(CUSTOMER_ENDPOINT, payload)
        if success and message:
            customer_id = extract_id(message, "name", "customer", "customer_id")
            if customer_id:
                results.customers.append(CreatedCustomer(
                    customer_id=customer_id,
                    customer_name=payload["customer_name"],
                    territory=payload["territory"],
                    lead_id=payload.get("lead_id"),
                ))
            else:
                results.customer_failures += 1
                logger.warning("Customer created but no id found in response: %s", message)
        else:
            results.customer_failures += 1
            logger.error("Failed to create customer #%d: %s", i, error)
        print_progress("Customers", i, count)


def seed_opportunities(results: SeedResults, count: int) -> None:
    logger.info("Creating %d Opportunities...", count)
    for i in range(1, count + 1):
        lead = results.leads[i - 1] if i - 1 < len(results.leads) else (
            random.choice(results.leads) if results.leads else None
        )
        customer = results.customers[i - 1] if i - 1 < len(results.customers) else (
            random.choice(results.customers) if results.customers else None
        )
        payload = build_opportunity_payload(lead)
        success, message, error = post_endpoint(OPPORTUNITY_ENDPOINT, payload)
        if success and message:
            opportunity_id = extract_id(message, "name", "opportunity", "opportunity_id")
            if opportunity_id:
                results.opportunities.append(CreatedOpportunity(
                    opportunity_id=opportunity_id,
                    lead_id=lead.lead_id if lead else None,
                    customer_id=customer.customer_id if customer else None,
                ))
            else:
                results.opportunity_failures += 1
                logger.warning("Opportunity created but no id found in response: %s", message)
        else:
            results.opportunity_failures += 1
            logger.error("Failed to create opportunity #%d: %s", i, error)
        print_progress("Opportunities", i, count)


def seed_quotations(results: SeedResults, count: int) -> None:
    logger.info("Creating %d Quotations...", count)
    if not results.customers:
        logger.error("No customers available; skipping quotations.")
        return
    if not results.ready_item_codes:
        logger.warning("No Items were successfully created; quotations will likely fail.")
    for i in range(1, count + 1):
        customer = results.customers[i % len(results.customers)]
        payload, grand_total = build_quotation_payload(customer, results.ready_item_codes)
        success, message, error = post_endpoint(QUOTATION_ENDPOINT, payload)
        if success and message:
            quotation_id = extract_id(message, "name", "quotation", "quotation_id")
            if quotation_id:
                results.quotations.append(CreatedQuotation(
                    quotation_id=quotation_id,
                    customer_id=customer.customer_id,
                    grand_total=grand_total,
                ))
            else:
                results.quotation_failures += 1
                logger.warning("Quotation created but no id found in response: %s", message)
        else:
            results.quotation_failures += 1
            logger.error("Failed to create quotation #%d: %s", i, error)
        print_progress("Quotations", i, count)


def seed_sales_orders(results: SeedResults, count: int) -> None:
    logger.info("Creating %d Sales Orders...", count)
    if not results.customers:
        logger.error("No customers available; skipping sales orders.")
        return
    if not results.ready_item_codes:
        logger.warning("No Items were successfully created; sales orders will likely fail.")
    for i in range(1, count + 1):
        quotation = results.quotations[i % len(results.quotations)] if results.quotations else None
        if quotation:
            customer = next(
                (c for c in results.customers if c.customer_id == quotation.customer_id),
                results.customers[i % len(results.customers)],
            )
        else:
            customer = results.customers[i % len(results.customers)]

        payload = build_sales_order_payload(customer, quotation, results.ready_item_codes)
        success, message, error = post_endpoint(SALES_ORDER_ENDPOINT, payload)
        if success and message:
            sales_order_id = extract_id(message, "name", "sales_order", "sales_order_id")
            if sales_order_id:
                results.sales_orders.append(sales_order_id)
            else:
                results.sales_order_failures += 1
                logger.warning("Sales Order created but no id found in response: %s", message)
        else:
            results.sales_order_failures += 1
            logger.error("Failed to create sales order #%d: %s", i, error)
        print_progress("Sales Orders", i, count)


# =====================================================================
# Summary
# =====================================================================

def print_summary(results: SeedResults, count: int, elapsed_seconds: float) -> None:
    def line(label: str, created: int, total: int, failed: int) -> str:
        color = ColorCodes.GREEN if failed == 0 else ColorCodes.YELLOW
        return f"{color}{label:<14} {created}/{total}  (failures: {failed}){ColorCodes.RESET}"

    print()
    print(f"{ColorCodes.BOLD}{ColorCodes.CYAN}===== Seeding Summary ====={ColorCodes.RESET}")
    print(line("Items:", len(results.ready_item_codes), len(PRODUCT_CATALOG), results.item_failures))
    print(line("Leads:", len(results.leads), count, results.lead_failures))
    print(line("Customers:", len(results.customers), count, results.customer_failures))
    print(line("Opportunities:", len(results.opportunities), count, results.opportunity_failures))
    print(line("Quotations:", len(results.quotations), count, results.quotation_failures))
    print(line("Sales Orders:", len(results.sales_orders), count, results.sales_order_failures))
    print(f"{ColorCodes.CYAN}Elapsed time: {elapsed_seconds:.1f}s{ColorCodes.RESET}")
    print(f"{ColorCodes.BOLD}{ColorCodes.CYAN}==========================={ColorCodes.RESET}")


# =====================================================================
# Entry point
# =====================================================================

def main() -> None:
    if ERP_URL == "https://your-erp-instance.com" or API_KEY.startswith("xxxx") or API_SECRET.startswith("xxxx"):
        logger.warning(
            "ERP_URL / API_KEY / API_SECRET still look like placeholders. "
            "Update them at the top of this script before running against a real instance."
        )

    start_time = time.monotonic()
    results = SeedResults()

    logger.info("Starting ERP seed run against %s", ERP_URL)

    seed_items(results)
    seed_leads(results, RECORD_COUNT)
    seed_customers(results, RECORD_COUNT)
    seed_opportunities(results, RECORD_COUNT)
    seed_quotations(results, RECORD_COUNT)
    seed_sales_orders(results, RECORD_COUNT)

    elapsed = time.monotonic() - start_time
    print_summary(results, RECORD_COUNT, elapsed)


if __name__ == "__main__":
    main()