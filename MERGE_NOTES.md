# Merge notes: unified-erp (CRUD) + dynamic-crud (auth)

## Base

`unified-erp` (`MagmaAssistance-Development`), as-is — this is the
version that was actually tested and confirmed working. Its CRUD layer
was kept untouched:

- `ERP_Unified/tools.py` — the single generic `erp_data_tool` /
  `erp_describe_fields` gateway, registered as the app's only tools
  (`ALL_TOOLS = list(ERP_UNIFIED_TOOLS)` in `server.py`).
- `ERP/dynamic_fields.py` — live schema-driven required-field discovery
  and plain-language error explanation (`explain_erp_error`).
- `ERP/erp_client.py` — talks straight to ERPNext's own stock REST API
  (`/api/resource/<Doctype>`, `/api/method/<name>`). No custom Frappe
  app required on the ERPNext side.

The old per-doctype tool files under `ERP/tools/*_write_tools.py` from
the `dynamic-crud` zip (sales/inventory/hr/accounts/purchase/
manufacturing/etc.) were **not** brought over — `unified-erp` had
already migrated off them in favor of `erp_data_tool`, and that's the
version you said you'd tested and preferred. `custom_ui_app/` (the
Frappe-side app the old CRUD tools depended on) was dropped entirely —
it's a second deployable that has to be installed inside an ERPNext
bench separately, and isn't needed for what's merged below.

## What was ported in from `dynamic-crud`

Only the authentication idea — a real per-user `ERPIdentity`, bound for
the duration of one chat turn — was kept, and it was **re-implemented
against plain Frappe, not `custom_ui_app`**:

### `ERP/erp_client.py`

- Added `ERPIdentity` (api_key/api_secret/user/roles), a `contextvars`-
  backed `use_identity()` / `current_identity()` pair (same pattern as
  the original — contextvars propagate correctly through `await`
  chains, so binding once around `agent_graph.ainvoke(...)` covers every
  tool call anywhere in the graph for that turn).
- Added `_auth_headers()`: returns the bound identity's own
  `Authorization: token <key>:<secret>` header if one is active,
  otherwise the module's shared service-account header. Every
  request-issuing method (`get_list`, `get_doc`, `get_meta`,
  `call_method`, `call_method_post`, `create_doc`, `update_doc`) now
  passes this explicitly instead of relying on `self.session`'s
  baked-in default header, so a bound identity is actually honored on
  every endpoint, not just one.
- Added `resolve_identity(api_key, api_secret)`: validates a person's
  own key/secret and fetches their roles using **only Frappe's own
  stock endpoints** —
  `GET /api/method/frappe.auth.get_logged_user` to resolve the token to
  a username (401/403 → `PermissionError`), then
  `GET /api/resource/User/<user>?fields=["roles"]` to read their roles
  (every Frappe user always has read access to their own `User` doc, so
  this needs no extra permission setup). This replaces the original's
  call to `custom_ui.api.auth.me` — same job, no custom app.
- Added `_raise_for_permission()`: a 403 from any of the above endpoints
  is now raised as `PermissionError(f"{user} does not have permission to
  {action} {doctype}...")` instead of a generic `HTTPError`, so the
  agent can tell the person the real reason.
- **Bug caught while porting, not present in either original file**:
  `self._cache` is one dict shared by the whole process. With per-user
  identities now possible, two different people's `get_list()`/
  `get_doc()`/`get_count()`/`call_method()` results for the same
  doctype+filters would otherwise collide in that cache — a good enough
  reason for User A to potentially see data cached under User B's
  permissions. Fixed by tagging every read cache key with
  `_identity_tag()` (the bound user, or `"_service"`), so each identity
  gets its own cache entries. `get_meta()`'s cache is untouched — a
  doctype's schema isn't user-specific.

### `server.py`

- `session_identities: Dict[str, ERPIdentity]` — session_id → identity,
  same shape as the original.
- `POST /api/session/identify` — `{session_id, erp_api_key,
  erp_api_secret}` → resolves via `erp_client.resolve_identity()`,
  caches it, returns `{authenticated, user, roles}`. 401 on bad
  credentials.
- `POST /api/session/logout` — drops the session's bound identity
  (falls back to the shared service account).
- `generate_reply()` now wraps `agent_graph.ainvoke(...)` in
  `with use_identity(session_identities.get(session_id)):` — every
  `erp_data_tool` call made anywhere in that turn runs with that
  person's own ERPNext credentials.
- `_execute_tool()` now catches `PermissionError` specifically (logged
  as `tool_status="permission_denied"` in the audit log) and returns the
  real denial reason to the agent/user, instead of falling into the
  generic `"'{tool}' failed to fetch ERP data right now."` message.

### What this buys you over the original `dynamic-crud` auth design

Frappe's `/api/resource/*` REST endpoints already enforce that
doctype's role-based permissions for whoever's token is used — that's
core Frappe behavior, not something `custom_ui_app` added. So binding a
person's own key/secret onto the *existing* `erp_data_tool` call path
gets you real per-user RBAC without deploying anything extra into
ERPNext. What `custom_ui_app` added on top (a 3-strikes admin email
alert after repeated denials) is **not** reproduced here — if you want
that specific alerting behavior, it would need to be added as an
ERPNext-side hook (e.g. a `User Settings` doctype or a scheduled report
over the audit log's `permission_denied` rows) rather than resurrecting
the separate Frappe app.

## What this does NOT cover yet

- **Frontend wiring**: nothing in this repo collects a person's ERPNext
  API key/secret and calls `/api/session/identify` before their first
  `/api/chat` — that's frontend work, same caveat the original
  `dynamic-crud` integration notes carried.
- **Not live-tested**: this was a static merge — no live ERPNext
  instance was available here to run the server end-to-end. Every
  edited file passes `ast.parse()` cleanly and the logic mirrors what
  `erp_client.py`'s other methods already do (session-based requests,
  cache-then-fetch, `_cache.clear()` after writes), but you should:
  1. Run `python server.py` against a real `.env` (see `.env.example`)
     and confirm the service-account path still works exactly as before
     (nothing above changes behavior when no identity is bound).
  2. Create two ERPNext users with different roles, generate API keys
     for each via *My Settings → API Access → Generate Keys*, call
     `/api/session/identify` with each, and confirm:
     - a read/write allowed for one role but not the other actually
       gets denied via `erp_data_tool` for the restricted user (and the
       chat reply says why, not a generic failure), and
     - the previously-noted cache bug fix actually holds (User A's
       `erp_data_tool(operation='list', ...)` doesn't return rows cached
       under User B's session).
  3. `custom_ui_app/` was intentionally dropped — if any other part of
     your stack (e.g. an ERPNext-side portal) still depends on it, that
     dependency is now unmet and needs to be handled separately; nothing
     in this repo calls into it anymore.

## Verified

- Every `.py` file in this repo parses cleanly (`ast.parse`).
- `server.py` and `ERP/erp_client.py` import structure checked by hand;
  no renamed/removed symbol that anything else in the repo still
  references.
