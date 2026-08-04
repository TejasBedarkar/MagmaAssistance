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

---

# Second pass: re-syncing against a newer `MagmaAssistance-Development` upload

A newer copy of the `MagmaAssistance-Development` branch (the same
branch used as the CRUD/base source above) was compared file-by-file
against this already-merged project to pull forward anything genuinely
new. Full `diff -rq` results below, with the disposition of each
difference.

## Applied

- **`requirements.txt`** — `PyMuPDF` was missing even though
  `LLM/LLM.py` still does `import fitz` and uses it for PDF OCR/
  rendering in two places. This project would have failed at import
  time on a clean install. Restored from the Development copy.
- **`db/postgres_audit_log.py`** — `record_file_upload()` didn't upsert
  the parent `sessions` row first, unlike `log_turn()` (which calls the
  `ensure_session()` helper already in this file). A file uploaded on a
  brand-new `session_id`, before any chat turn had run for it, could
  violate `file_uploads_session_id_fkey`. The Development copy had its
  own inline fix for this same bug (a raw `INSERT INTO sessions ...
  ON CONFLICT DO NOTHING` duplicated inside `record_file_upload`); ported
  the fix forward using this project's existing `ensure_session()` helper
  instead of duplicating the insert.

## Checked, no action needed (base is already ahead)

- **`ERP/erp_client.py`**, **`ERP/mcp_server.py`** — the Development
  copy is missing the per-user `ERPIdentity`/`use_identity()` auth layer,
  `get_meta()`/`get_count()`, and the count-aware list-tool helpers —
  all of that is already in this project (see the main merge notes
  above and `ENHANCEMENTS.md`). Nothing to pull in.
- **`LLM/LLM.py`** (system prompt), **`server.py`** (`MagnaERP` branding,
  `_apply_user_facing_brand`) — this project deliberately dropped the
  "always call it MagnaERP" branding layer and the old per-doctype,
  OCR-heavy system prompt in favor of the shorter prompt + Markdown-table
  reply formatting described in `ENHANCEMENTS.md`. Not reverted.
- **`test/test_tool_contracts.py`** — this project's tests were already
  rewritten for the dynamic/doctype-agnostic tool set; the Development
  copy's tests target the old per-doctype tool modules directly, which
  this project doesn't register. Not reverted.
- **`server.py` — document-upload write confirmation**
  (`_confirmation_prompt` / `_confirmation_answer` / `_is_write_tool`):
  in the Development copy, a write triggered from data extracted out of
  an *uploaded document* pauses and asks the user to reply yes/no before
  saving. This project's PO-upload endpoint (`/api/upload-po`) instead
  calls the OCR auto-create tool directly and unconditionally (see the
  docstring on `upload_purchase_order_file` in `server.py` for the
  reasoning: it deliberately bypasses the chat agent's tool selection to
  avoid it picking the wrong `create_purchase_order` tool). Porting the
  Development copy's confirm-before-save step back in is a real, worth-
  considering safety improvement for OCR-derived data specifically, but
  it's a behavior change, not a bug fix, and doesn't have a like-for-like
  home in the current `ERP_Unified`-based flow (the old flow's
  `ALL_REQUIRED_FIELDS`/`ALL_FIELD_PARSERS` it depended on are
  intentionally empty here — see the comment above `ALL_TOOLS` in
  `server.py`). Flagged rather than silently added; happy to build it
  against the OCR-upload endpoint specifically if wanted.
- **`ERP/tools/*_write_tools.py`, `ERP/tools/capabilities_tools.py`,
  new `ERP/tools/{inventory,purchase,module}_read_tools.py`** — all
  per-doctype tool modules from the old (pre-`ERP_Unified`) architecture.
  Per the original merge decision above, these are superseded by
  `ERP_Unified/tools.py` + `ERP/dynamic_fields.py` and are not wired
  into `server.py` (`ALL_TOOLS = list(ERP_UNIFIED_TOOLS)`), so newer
  versions of them from the Development copy were not pulled in. The one
  exception, `ERP/tools/ocr_po_tool.py`, *is* still actively used (the
  PO-upload endpoint calls `process_ocr_po_and_create_order` directly) —
  its Development-copy diff was checked and is branding text only
  ("MagnaERP" → "ERPNext"), already consistent with this project.
- `langgraph.json` — line-ending only (CRLF vs LF), no content change.
- `README.md` — already describes this merged project accurately.

## Not applicable

- `ERP_Unified/`, `erp_theme/` (the whole Frappe-side custom UI/auth
  app), `.env.example` — don't exist in the Development copy at all;
  it predates/doesn't include that work.
