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
        response = self.session.post(url, json=(data or {}), timeout=DEFAULT_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()

        # Any write can make previously-cached list/doc reads stale.
        self._cache.clear()

        return payload.get("message", payload)


    def create_doc(self, doctype, data):
        """Create a new document: POST /api/resource/<Doctype>
        Used for seeding demo data — not exposed as an agent tool."""
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        url = f"{self.base_url}/api/resource/{doctype}"
        response = self.session.post(url, json=data, timeout=DEFAULT_TIMEOUT_SECONDS)
        response.raise_for_status()
        return response.json().get("data", {})

    


erp_client = ERPClient()