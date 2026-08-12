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

--------------------------------------------------------------------------
Per-user identity
--------------------------------------------------------------------------
The api_key/api_secret loaded below are a single SHARED SERVICE ACCOUNT —
fine for internal/system calls (seed_erp.py, startup checks) that aren't
attributable to one human, but by default every agent tool call runs as
this one identity regardless of who is actually chatting.

To make the agent respect real per-person ERPNext roles, server.py binds
an `ERPIdentity` (that person's own API key/secret, resolved once via
resolve_identity() below) for the duration of each chat turn using
`use_identity()`. While bound, every request this client issues
(get_list/get_doc/get_meta/create_doc/update_doc/call_method/...) is sent
with THAT PERSON'S OWN Authorization header instead of the shared service
account's. Nothing else about the request shape changes — this still
talks to ERPNext's own stock REST API
(`/api/resource/<Doctype>`, `/api/method/<name>`), so Frappe's own,
built-in role/permission engine enforces exactly what that person is
allowed to do, the same as if they'd logged into the ERPNext UI
themselves. No custom Frappe app needs to be installed for this — a
403 from Frappe is simply translated into a PermissionError below (see
`_raise_for_permission`) so callers can show the real reason instead of a
generic failure.

Calls made with no identity bound (nothing in `use_identity`'s scope)
keep using the shared service account exactly as before — this is what
covers system/internal calls and keeps this file backward compatible on
its own.
"""

import contextlib
import contextvars
import json
import logging
import os
import time

from pathlib import Path
from typing import Optional
import requests
from dotenv import load_dotenv

# Project root folder se exact .env file locate karke load karein
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()  # Fallback current directory

DEFAULT_TIMEOUT_SECONDS = 15
DEFAULT_CACHE_TTL_SECONDS = 45
# DocType field definitions change far less often than the records
# themselves, so they get their own, much longer-lived cache (see
# get_meta() / self._meta_cache below) instead of sharing the 45s
# data cache.
META_CACHE_TTL_SECONDS = 3600


class ERPIdentity:
    """A real ERPNext user's own credentials, resolved once (via
    resolve_identity(), below) and bound for the duration of one agent
    turn. Distinct from the module-level shared service account."""

    __slots__ = ("api_key", "api_secret", "user", "roles")

    def __init__(self, api_key: str, api_secret: str, user: str = None, roles=None):
        self.api_key = api_key
        self.api_secret = api_secret
        self.user = user
        self.roles = roles or []

    def __repr__(self):
        return f"ERPIdentity(user={self.user!r}, roles={self.roles!r})"


# Per-async-task identity binding. contextvars propagate correctly through
# `await` chains, so binding this once around `agent_graph.ainvoke(...)`
# in server.py is enough to cover every tool call made anywhere during
# that turn, however deep the LangGraph call stack goes.
_active_identity: "contextvars.ContextVar[Optional[ERPIdentity]]" = contextvars.ContextVar(
    "erp_active_identity", default=None
)


@contextlib.contextmanager
def use_identity(identity: Optional[ERPIdentity]):
    """Bind `identity` for the duration of the `with` block. Pass None to
    explicitly run as the shared service account (same as not binding
    anything) — useful for system calls that intentionally shouldn't be
    attributed to a person."""
    token = _active_identity.set(identity)
    try:
        yield
    finally:
        _active_identity.reset(token)


def current_identity() -> Optional[ERPIdentity]:
    """The ERPIdentity bound for the current call, if any."""
    return _active_identity.get()


class ERPClient:
    def __init__(self, cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS):
        # Multi-variable Fallback Support
        self.base_url = (
            os.getenv("ERP_URL") 
            or os.getenv("ERPNEXT_URL") 
            or os.getenv("FRAPPE_URL") 
            or ""
        ).rstrip("/")

        self.api_key = (
            os.getenv("ERP_API_KEY") 
            or os.getenv("ERPNEXT_API_KEY") 
            or os.getenv("FRAPPE_API_KEY")
        )

        self.api_secret = (
            os.getenv("ERP_API_SECRET") 
            or os.getenv("ERPNEXT_API_SECRET") 
            or os.getenv("FRAPPE_API_SECRET")
        )

        self.cache_ttl_seconds = cache_ttl_seconds

        if not self.base_url:
            logging.warning("ERP_URL is not set — ERP tools will fail until it's configured in .env")

        self.session = requests.Session()
        if self.api_key and self.api_secret:
            self.session.headers.update({"Authorization": f"token {self.api_key}:{self.api_secret}"})
        else:
            logging.warning(
                "ERP_API_KEY / ERP_API_SECRET not set — ERP requests will be "
                "unauthenticated and will likely fail with a 403."
            )

        self._cache = {}  # cache_key -> (timestamp, data)
        self._meta_cache = {}  # doctype -> (timestamp, doctype_definition)

    # ---------------------------------------------------------------
    # Per-user identity
    # ---------------------------------------------------------------

    def _auth_headers(self) -> dict:
        """Authorization header for the current call: the bound
        ERPIdentity's own key/secret if one is active (see use_identity
        in this module), otherwise this client's shared service-account
        key. Every request-issuing method below passes this explicitly
        (it overrides self.session's baked-in default header for that
        one request) so a bound identity is actually honored everywhere,
        not just on one endpoint."""
        identity = _active_identity.get()
        if identity and identity.api_key and identity.api_secret:
            return {"Authorization": f"token {identity.api_key}:{identity.api_secret}"}
        if self.api_key and self.api_secret:
            return {"Authorization": f"token {self.api_key}:{self.api_secret}"}
        return {}

    def resolve_identity(self, api_key: str, api_secret: str) -> "ERPIdentity":
        """Validate a person's own ERPNext API key/secret and fetch their
        roles, using nothing but Frappe's own stock endpoints (no custom
        app required):
          1. GET /api/method/frappe.auth.get_logged_user, with THIS
             key/secret as the Authorization header — Frappe resolves the
             token to a user internally, so a 401/403 here means the key/
             secret pair isn't valid (or was revoked).
          2. GET /api/resource/User/<user> (same header) to read that
             user's own `roles` child table — every Frappe user always has
             read permission on their own User document, so this needs no
             extra permission setup on the ERPNext side.

        Raises PermissionError if the credentials don't resolve to a real
        logged-in user. Call this once per chat session (e.g. from a
        `/api/session/identify` endpoint) and hand the result to
        use_identity() for the session's turns."""
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        headers = {"Authorization": f"token {api_key}:{api_secret}"}

        who_url = f"{self.base_url}/api/method/frappe.auth.get_logged_user"
        response = requests.get(who_url, headers=headers, timeout=DEFAULT_TIMEOUT_SECONDS)
        if response.status_code in (401, 403):
            raise PermissionError("Those ERPNext API credentials are not valid or not logged in.")
        response.raise_for_status()
        user = response.json().get("message")
        if not user or user == "Guest":
            raise PermissionError("Those ERPNext API credentials are not valid or not logged in.")

        roles = []
        try:
            user_url = f"{self.base_url}/api/resource/User/{user}"
            user_response = requests.get(
                user_url, headers=headers, timeout=DEFAULT_TIMEOUT_SECONDS,
                params={"fields": json.dumps(["roles"])},
            )
            user_response.raise_for_status()
            role_rows = user_response.json().get("data", {}).get("roles", []) or []
            roles = [r.get("role") for r in role_rows if r.get("role")]
        except Exception:
            # Roles are informational (shown to the person, used in log
            # lines) — a hiccup fetching them shouldn't block sign-in,
            # since every real permission check still happens per-request
            # via Frappe's own enforcement, not this list.
            logging.exception("Could not fetch roles for ERPNext user '%s'", user)

        return ERPIdentity(api_key=api_key, api_secret=api_secret, user=user, roles=roles)

    def _identity_tag(self):
        """A short, cache-key-safe tag for whoever is currently bound
        (or '_service' for the shared account), so two different people's
        get_list()/get_doc() results for the same doctype/filters never
        collide in self._cache — each user (and permission level) gets
        their own cache entries."""
        identity = _active_identity.get()
        return identity.user if identity and identity.user else "_service"

    def _raise_for_permission(self, response, doctype: str, action: str):
        """Translate a 403 from Frappe's own permission engine into a
        PermissionError naming who was denied, instead of letting it fall
        through to raise_for_status()'s generic HTTPError. Called right
        before raise_for_status() in every request method below."""
        if response.status_code == 403:
            identity = _active_identity.get()
            who = identity.user if identity and identity.user else "This user"
            raise PermissionError(
                f"{who} does not have permission to {action} {doctype} in ERPNext."
            )

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

    def get_list(self, doctype, fields=None, filters=None, or_filters=None, order_by=None, limit=20, use_cache=True):
        """Fetch a list of documents for a doctype:
        GET /api/resource/<Doctype>?fields=[...]&filters=[...]&limit_page_length=N

        `fields` is a list of field names, e.g. ["name", "customer", "grand_total"].
        `filters` follows ERPNext's filter format, e.g.
            [["status", "=", "Overdue"], ["outstanding_amount", ">", 0]]
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        cache_key = ("list", self._identity_tag(), doctype, json.dumps(fields), json.dumps(filters), json.dumps(or_filters), order_by, limit)
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        params = {"limit_page_length": limit}
        if fields:
            params["fields"] = json.dumps(fields)
        if filters:
            params["filters"] = json.dumps(filters)
        if or_filters:
            params["or_filters"] = json.dumps(or_filters)
        if order_by:
            params["order_by"] = order_by

        url = f"{self.base_url}/api/resource/{doctype}"
        response = self.session.get(
            url, params=params, timeout=DEFAULT_TIMEOUT_SECONDS, headers=self._auth_headers()
        )
        self._raise_for_permission(response, doctype, "list")
        response.raise_for_status()
        data = response.json().get("data", [])

        if use_cache:
            self._cache_set(cache_key, data)

        return data

    def get_doc(self, doctype, name, use_cache=True):
        """Fetch a single document by name: GET /api/resource/<Doctype>/<name>"""
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        cache_key = ("doc", self._identity_tag(), doctype, name)
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        url = f"{self.base_url}/api/resource/{doctype}/{name}"
        response = self.session.get(url, timeout=DEFAULT_TIMEOUT_SECONDS, headers=self._auth_headers())
        self._raise_for_permission(response, doctype, "view")
        response.raise_for_status()
        data = response.json().get("data", {})

        if use_cache:
            self._cache_set(cache_key, data)

        return data

    def get_meta(self, doctype, use_cache=True):
        """Fetch a DocType's own definition — GET /api/resource/DocType/<doctype>.

        Frappe stores every doctype's field list (fieldname, label,
        fieldtype, reqd, options, description, etc.) as a document of
        the built-in 'DocType' doctype itself, so this is just a
        get_doc("DocType", doctype) under the hood. This is what makes
        field discovery DYNAMIC: instead of hand-maintaining which
        fields are mandatory for each ERPNext doctype, callers (see
        ERP/dynamic_fields.py) read it straight from the live schema,
        so it stays correct even if the ERPNext site customizes a
        doctype or ERPNext itself changes required fields in an
        upgrade.

        Cached far longer than list/doc reads (via META_CACHE_TTL_SECONDS)
        since a doctype's field definitions change far less often than
        its data.
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        cache_key = ("meta", doctype)
        if use_cache:
            cached = self._meta_cache.get(doctype)
            if cached is not None:
                timestamp, data = cached
                if time.time() - timestamp <= META_CACHE_TTL_SECONDS:
                    return data

        url = f"{self.base_url}/api/resource/DocType/{doctype}"
        response = self.session.get(url, timeout=DEFAULT_TIMEOUT_SECONDS, headers=self._auth_headers())
        self._raise_for_permission(response, doctype, "read the schema of")
        response.raise_for_status()
        data = response.json().get("data", {})

        if use_cache:
            self._meta_cache[doctype] = (time.time(), data)

        return data

    def get_count(self, doctype, filters=None, use_cache=True):
        """Get the TRUE total number of records matching `filters` for
        `doctype`, via Frappe's core `frappe.client.get_count` whitelisted
        method — independent of any `limit_page_length` a caller used
        for get_list(). This exists so list-style tools can tell a user
        'showing 20 of 306' instead of silently returning a truncated
        page with no indication more records exist.
        """
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        params = {"doctype": doctype}
        if filters:
            params["filters"] = json.dumps(filters)

        cache_key = ("count", self._identity_tag(), doctype, json.dumps(filters))
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        count = self.call_method("frappe.client.get_count", params=params, use_cache=False)
        count = int(count)

        if use_cache:
            self._cache_set(cache_key, count)

        return count

    def call_method(self, method, params=None, use_cache=True):
        """Call a whitelisted custom method: GET /api/method/<method>
        Use this instead of get_list()/get_doc() if your ERPNext has a
        custom app exposing endpoints (e.g. sales_app.api.sales_order.*)."""
        if not self.base_url:
            raise RuntimeError("ERP_URL is not configured.")

        cache_key = ("method", self._identity_tag(), method, json.dumps(params))
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        url = f"{self.base_url}/api/method/{method}"
        response = self.session.get(
            url, params=params, timeout=DEFAULT_TIMEOUT_SECONDS, headers=self._auth_headers()
        )
        self._raise_for_permission(response, method, "call")
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
            headers={**self._auth_headers(), "Expect": ""},
        )
        self._raise_for_permission(response, method, "call")
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

        url = f"{self.base_url}/api/resource/{doctype}"
        response = self.session.post(
            url, json=data, timeout=DEFAULT_TIMEOUT_SECONDS,
            headers={**self._auth_headers(), "Expect": ""},
        )
        self._raise_for_permission(response, doctype, "create")

        # Detailed Error Reporting for ERPNext Validation Rules
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as e:
            error_details = ""
            try:
                err_json = response.json()
                if "_server_messages" in err_json:
                    messages = json.loads(err_json["_server_messages"])
                    error_details = " | ERPNext Rule Failure: " + " ".join([json.loads(m).get("message", "") for m in messages])
                elif "exception" in err_json:
                    error_details = f" | Exception: {err_json['exception']}"
                elif "message" in err_json:
                    error_details = f" | Message: {err_json['message']}"
            except Exception:
                error_details = f" | Raw Response: {response.text}"
            
            raise requests.exceptions.HTTPError(f"{e}{error_details}", response=response)

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

        url = f"{self.base_url}/api/resource/{doctype}/{name}"
        # Same "Expect: 100-continue" workaround as call_method_post/
        # create_doc — see the comment on call_method_post for why.
        response = self.session.put(
            url, json=data, timeout=DEFAULT_TIMEOUT_SECONDS,
            headers={**self._auth_headers(), "Expect": ""},
        )
        self._raise_for_permission(response, doctype, "update")

        # Detailed Error Reporting for ERPNext Validation Rules
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as e:
            error_details = ""
            try:
                err_json = response.json()
                if "_server_messages" in err_json:
                    messages = json.loads(err_json["_server_messages"])
                    error_details = " | ERPNext Rule Failure: " + " ".join([json.loads(m).get("message", "") for m in messages])
                elif "exception" in err_json:
                    error_details = f" | Exception: {err_json['exception']}"
            except Exception:
                error_details = f" | Raw Response: {response.text}"
            
            raise requests.exceptions.HTTPError(f"{e}{error_details}", response=response)

        self._cache.clear()

        return response.json().get("data", {})

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