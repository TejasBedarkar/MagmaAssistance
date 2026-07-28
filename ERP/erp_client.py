"""
ERP/erp_client.py

Thin wrapper around ERPNext's standard REST API
(/api/resource/<Doctype>), authenticated with an API key/secret. This is
recommended over session-cookie login (/api/method/login) for a backend
service — a session can expire and needs re-login; an API key/secret
doesn't, until you revoke it.

Setup (in ERPNext):
    User menu -> My Settings -> API Access -> Generate Keys

Then set these in a .env file next to server.py:
    ERP_URL=https://your-site.erpnext.com
    ERP_API_KEY=xxxxxxxxxxxxxxx
    ERP_API_SECRET=xxxxxxxxxxxxxxx

If your ERPNext instance instead has a custom app exposing whitelisted
methods (e.g. sales_app.api.sales_order.get_sales_summary), use
call_method() instead of get_list()/get_doc() — the auth/session setup
below works the same either way, only the endpoint shape changes.
"""

import json
import logging
import os
import time

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("erp-client")

DEFAULT_TIMEOUT_SECONDS = 15
DEFAULT_CACHE_TTL_SECONDS = 45


class ERPClient:
    def __init__(self, cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS):
        self.base_url = (os.getenv("ERP_URL") or "").rstrip("/")
        self.api_key = os.getenv("ERP_API_KEY")
        self.api_secret = os.getenv("ERP_API_SECRET")
        self.cache_ttl_seconds = cache_ttl_seconds

        if not self.base_url:
            logger.warning("ERP_URL is not set — ERP tools will fail until it's configured in .env")

        self.session = requests.Session()
        if self.api_key and self.api_secret:
            self.session.headers.update({"Authorization": f"token {self.api_key}:{self.api_secret}"})
        else:
            logger.warning(
                "ERP_API_KEY / ERP_API_SECRET not set — ERP requests will be "
                "unauthenticated and will likely fail with a 403."
            )

        self._cache = {}  # cache_key -> (timestamp, data)

    # ---------------------------------------------------------------
    # Caching
    # ---------------------------------------------------------------

    def _cache_get(self, key):
        entry = self._cache.get(key)
        if not entry:
            return None
        timestamp, data = entry
        if time.time() - timestamp > self.cache_ttl_seconds:
            return None
        return data

    def _cache_set(self, key, data):
        self._cache[key] = (time.time(), data)

    # ---------------------------------------------------------------
    # Low-level requests
    # ---------------------------------------------------------------

    def get_list(self, doctype, fields=None, filters=None, order_by=None, limit=20, use_cache=True):
        """Fetch a list of documents for a doctype:
        GET /api/resource/<Doctype>?fields=[...]&filters=[...]&limit_page_length=N

        `fields` is a list of field names, e.g. ["name", "customer", "grand_total"].
        `filters` follows ERPNext's filter format, e.g.
            [["status", "=", "Overdue"], ["outstanding_amount", ">", 0]]
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        if filters:
            filters = self._resolve_filters(doctype, filters)

        cache_key = ("list", doctype, json.dumps(fields), json.dumps(filters), order_by, limit)
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        params = {"limit_page_length": limit}
        if fields:
            params["fields"] = json.dumps(fields)
        if filters:
            params["filters"] = json.dumps(filters)
        if order_by:
            params["order_by"] = order_by

        url = f"{self.base_url}/api/resource/{doctype}"
        response = self.session.get(url, params=params, timeout=DEFAULT_TIMEOUT_SECONDS)
        response.raise_for_status()
        data = response.json().get("data", [])

        if use_cache:
            self._cache_set(cache_key, data)

        return data

    def get_doc(self, doctype, name, use_cache=True):
        """Fetch a single document by name: GET /api/resource/<Doctype>/<name>"""
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        name = self._resolve_id(doctype, name)

        cache_key = ("doc", doctype, name)
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        url = f"{self.base_url}/api/resource/{doctype}/{name}"
        response = self.session.get(url, timeout=DEFAULT_TIMEOUT_SECONDS)
        response.raise_for_status()
        data = response.json().get("data", {})

        if use_cache:
            self._cache_set(cache_key, data)

        return data

    def call_method(self, method, params=None, use_cache=True):
        """Call a whitelisted custom method: GET /api/method/<method>
        Use this instead of get_list()/get_doc() if your ERPNext has a
        custom app exposing endpoints (e.g. sales_app.api.sales_order.*)."""
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        cache_key = ("method", method, json.dumps(params))
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        url = f"{self.base_url}/api/method/{method}"
        response = self.session.get(url, params=params, timeout=DEFAULT_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()
        data = payload.get("message", payload)

        if use_cache:
            self._cache_set(cache_key, data)

        return data
    
    def call_method_post(self, method, data=None):
        """Call a whitelisted method via POST: POST /api/method/<method>

        Use this for the custom sales_app write endpoints (e.g.
        sales_app.api.lead.create_lead, sales_app.api.customer.update_customer)
        documented in the Sales App API Reference — these are actions with
        side effects, so unlike call_method() this is never cached, and it
        clears the read cache afterwards so a get_list()/get_doc() called
        right after a create/update doesn't hand back stale data.

        Note on CSRF: the docs mention an X-Frappe-CSRF-Token header for
        POSTs, but that's only required for cookie/session-based logins.
        This client authenticates with an API key/secret (Authorization:
        token ...), which Frappe exempts from CSRF checks, so no CSRF
        token handling is needed here.
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        url = f"{self.base_url}/api/method/{method}"
        # requests/http.client can send an "Expect: 100-continue" header on
        # POST bodies of certain sizes. Werkzeug's development server (what
        # a local `bench start` / dev site runs on) doesn't implement that
        # handshake and rejects the request outright with
        # "417 Expectation Failed" before your ERP code ever sees it — even
        # though the same request works fine from curl (which doesn't send
        # Expect for small bodies) or against a production server behind
        # gunicorn/nginx. Explicitly blanking the header here disables it.
        response = self.session.post(
            url,
            json=(data or {}),
            timeout=DEFAULT_TIMEOUT_SECONDS,
            headers={"Expect": ""},
        )
        response.raise_for_status()
        payload = response.json()

        # Any write can make previously-cached list/doc reads stale.
        self._cache.clear()

        return payload.get("message", payload)


    def create_doc(self, doctype, data):
        """Create a new document: POST /api/resource/<Doctype>

        This is ERPNext's default/standard REST endpoint — as of the v16
        migration this is what all the agent's write tools use (see
        ERP/tools/sales_write_tools.py), not just demo-data seeding.
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        data = self._resolve_parties_in_data(doctype, data)

        url = f"{self.base_url}/api/resource/{doctype}"
        response = self.session.post(
            url, json=data, timeout=DEFAULT_TIMEOUT_SECONDS, headers={"Expect": ""}
        )
        response.raise_for_status()

        # A create can affect list reads (e.g. a new Lead should show up
        # in a subsequent get_list("Lead", ...)) so clear the read cache,
        # same as call_method_post() does for custom-method writes.
        self._cache.clear()

        return response.json().get("data", {})

    def update_doc(self, doctype, name, data):
        """Update an existing document: PUT /api/resource/<Doctype>/<name>

        `data` should only contain the fields you want changed — ERPNext
        merges this into the existing document rather than replacing it
        wholesale (the one exception is child tables like Quotation/Sales
        Order `items`: passing `items` replaces the whole table, it
        doesn't append to it).
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        name = self._resolve_id(doctype, name)
        data = self._resolve_parties_in_data(doctype, data)

        url = f"{self.base_url}/api/resource/{doctype}/{name}"
        # Same "Expect: 100-continue" workaround as call_method_post/
        # create_doc — see the comment on call_method_post for why.
        response = self.session.put(
            url, json=data, timeout=DEFAULT_TIMEOUT_SECONDS, headers={"Expect": ""}
        )
        response.raise_for_status()

        self._cache.clear()

        return response.json().get("data", {})

    # ---------------------------------------------------------------
    # Name-to-ID Resolvers
    # ---------------------------------------------------------------

    def _resolve_item_code(self, item_ref: str) -> str:
        """Resolve an item code from name or code."""
        if not item_ref:
            return item_ref
        # 1. Exact match on name/code
        try:
            res = self.get_list("Item", fields=["name"], filters=[["name", "=", item_ref]], limit=1)
            if res:
                return item_ref
        except Exception:
            pass
        # 2. Match on item_name exactly
        try:
            res = self.get_list("Item", fields=["name"], filters=[["item_name", "=", item_ref]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        # 3. Match on item_name partially
        try:
            res = self.get_list("Item", fields=["name"], filters=[["item_name", "like", f"%{item_ref}%"]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        return item_ref

    def _resolve_lead_id(self, lead_ref: str) -> str:
        """Resolve a Lead ID from name or ID."""
        if not lead_ref:
            return lead_ref
        try:
            res = self.get_list("Lead", fields=["name"], filters=[["name", "=", lead_ref]], limit=1)
            if res:
                return lead_ref
        except Exception:
            pass
        try:
            res = self.get_list("Lead", fields=["name"], filters=[["lead_name", "=", lead_ref]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        try:
            res = self.get_list("Lead", fields=["name"], filters=[["lead_name", "like", f"%{lead_ref}%"]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        return lead_ref

    def _resolve_customer_id(self, customer_ref: str) -> str:
        """Resolve a Customer ID from name or ID."""
        if not customer_ref:
            return customer_ref
        try:
            res = self.get_list("Customer", fields=["name"], filters=[["name", "=", customer_ref]], limit=1)
            if res:
                return customer_ref
        except Exception:
            pass
        try:
            res = self.get_list("Customer", fields=["name"], filters=[["customer_name", "=", customer_ref]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        try:
            res = self.get_list("Customer", fields=["name"], filters=[["customer_name", "like", f"%{customer_ref}%"]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        return customer_ref

    def _resolve_supplier_id(self, supplier_ref: str) -> str:
        """Resolve a Supplier ID from name or ID."""
        if not supplier_ref:
            return supplier_ref
        try:
            res = self.get_list("Supplier", fields=["name"], filters=[["name", "=", supplier_ref]], limit=1)
            if res:
                return supplier_ref
        except Exception:
            pass
        try:
            res = self.get_list("Supplier", fields=["name"], filters=[["supplier_name", "=", supplier_ref]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        try:
            res = self.get_list("Supplier", fields=["name"], filters=[["supplier_name", "like", f"%{supplier_ref}%"]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        return supplier_ref

    def _resolve_link_id(self, doctype: str, value: str) -> str:
        """Resolve any link field value by checking if it exists as an ID, 
        or finding the first ID that matches partially."""
        if not value:
            return value
        # 1. Check if it already exists as an exact ID
        try:
            res = self.get_list(doctype, fields=["name"], filters=[["name", "=", value]], limit=1)
            if res:
                return value
        except Exception:
            pass
        # 2. Check if any ID contains the value (partial match)
        try:
            res = self.get_list(doctype, fields=["name"], filters=[["name", "like", f"%{value}%"]], limit=1)
            if res:
                return res[0]["name"]
        except Exception:
            pass
        return value

    def _resolve_id(self, doctype: str, name: str) -> str:
        """Helper to resolve a possibly-friendly name to its true ID for a given doctype."""
        if doctype == "Item" and name != "Item":
            return self._resolve_item_code(name)
        elif doctype == "Lead" and name != "Lead":
            return self._resolve_lead_id(name)
        elif doctype == "Customer" and name != "Customer":
            return self._resolve_customer_id(name)
        elif doctype == "Supplier" and name != "Supplier":
            return self._resolve_supplier_id(name)
        elif doctype in ("Company", "Warehouse", "Workstation", "Operation", "Employee", "Work Order", "Production Plan", "Job Card", "Stock Entry", "BOM"):
            return self._resolve_link_id(doctype, name)
        return name

    def _resolve_items_in_data(self, data: dict) -> dict:
        """Resolve item_code for all items in the items child table of a document data dict."""
        if not data or not isinstance(data, dict):
            return data
        items = data.get("items")
        if items and isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and "item_code" in item:
                    item["item_code"] = self._resolve_item_code(item["item_code"])
        return data

    def _resolve_parties_in_data(self, doctype: str, data: dict) -> dict:
        """Resolve name-to-ID for common customer/lead/supplier/item/warehouse/company references in document data."""
        if not data or not isinstance(data, dict):
            return data
        
        # 1. Resolve top-level fields
        if "customer" in data:
            data["customer"] = self._resolve_customer_id(data["customer"])
        if "lead" in data:
            data["lead"] = self._resolve_lead_id(data["lead"])
        if "supplier" in data:
            data["supplier"] = self._resolve_supplier_id(data["supplier"])
        if "item_code" in data:
            data["item_code"] = self._resolve_item_code(data["item_code"])
        if "production_item" in data:
            data["production_item"] = self._resolve_item_code(data["production_item"])
        
        # Resolve company
        if "company" in data:
            data["company"] = self._resolve_link_id("Company", data["company"])
        # Resolve warehouses
        for wh_field in ("warehouse", "fg_warehouse", "wip_warehouse", "source_warehouse", "from_warehouse", "to_warehouse"):
            if wh_field in data:
                data[wh_field] = self._resolve_link_id("Warehouse", data[wh_field])
        
        # Resolve other manufacturing fields
        if "workstation" in data:
            data["workstation"] = self._resolve_link_id("Workstation", data["workstation"])
        if "operation" in data:
            data["operation"] = self._resolve_link_id("Operation", data["operation"])
        if "employee" in data:
            if isinstance(data["employee"], str):
                data["employee"] = self._resolve_link_id("Employee", data["employee"])
            elif isinstance(data["employee"], list):
                for emp_row in data["employee"]:
                    if isinstance(emp_row, dict) and "employee" in emp_row:
                        emp_row["employee"] = self._resolve_link_id("Employee", emp_row["employee"])
        if "work_order" in data:
            data["work_order"] = self._resolve_link_id("Work Order", data["work_order"])
        if "bom_no" in data:
            data["bom_no"] = self._resolve_link_id("BOM", data["bom_no"])

        # Opportunity party fields
        if doctype == "Opportunity":
            party_type = data.get("opportunity_from")
            party_name = data.get("party_name")
            if party_type and party_name:
                if party_type == "Lead":
                    data["party_name"] = self._resolve_lead_id(party_name)
                elif party_type == "Customer":
                    data["party_name"] = self._resolve_customer_id(party_name)

        # 2. Resolve items table if present
        data = self._resolve_items_in_data(data)
        
        # Also resolve production plan items (po_items)
        po_items = data.get("po_items")
        if po_items and isinstance(po_items, list):
            for item in po_items:
                if isinstance(item, dict):
                    if "item_code" in item:
                        item["item_code"] = self._resolve_item_code(item["item_code"])
                    if "bom_no" in item:
                        item["bom_no"] = self._resolve_link_id("BOM", item["bom_no"])

        return data

    def _resolve_filters(self, doctype: str, filters: list) -> list:
        """Best-effort resolve filters that query on lead, customer, supplier, or item fields."""
        if not filters or not isinstance(filters, list):
            return filters
        
        resolved = []
        for f in filters:
            if isinstance(f, list) and len(f) >= 3:
                field, op, val = f[0], f[1], f[2]
                if isinstance(val, str):
                    if field == "customer":
                        val = self._resolve_customer_id(val)
                    elif field == "lead":
                        val = self._resolve_lead_id(val)
                    elif field == "supplier":
                        val = self._resolve_supplier_id(val)
                    elif field == "item_code":
                        val = self._resolve_item_code(val)
                    elif field == "production_item":
                        val = self._resolve_item_code(val)
                    elif field in ("company", "warehouse", "fg_warehouse", "wip_warehouse", "source_warehouse", "from_warehouse", "to_warehouse", "workstation", "operation", "employee", "work_order", "bom_no"):
                        val = self._resolve_link_id(field.replace("fg_warehouse", "Warehouse").replace("wip_warehouse", "Warehouse").replace("source_warehouse", "Warehouse").replace("from_warehouse", "Warehouse").replace("to_warehouse", "Warehouse").replace("production_item", "Item").capitalize(), val)
                resolved.append([field, op, val])
            else:
                resolved.append(f)
        return resolved

    def submit_doc(self, doctype, name):
        """Submit a submittable document (docstatus 0 -> 1), e.g. finalizing
        a draft Sales Order, via Frappe's core `frappe.client.submit`
        whitelisted method. This ships with Frappe itself — it is NOT part
        of the old custom sales_app, so it keeps working after that app is
        removed in v16.

        frappe.client.submit expects the *full* document (not just its
        name), so this fetches the current doc first and posts that.
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        doc = self.get_doc(doctype, name, use_cache=False)
        result = self.call_method_post("frappe.client.submit", {"doc": json.dumps(doc)})

        self._cache.clear()

        return result


erp_client = ERPClient()