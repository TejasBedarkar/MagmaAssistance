# Magna AI — Architecture & Cleanup Plan

> Status: **inherited system, under review.** This file is the source of truth for
> what is live, what is dead, and what we are changing. Update it as work lands.
> Written from a read-only code investigation (2026-09-04).
>
> **Current state (2026-09-04):** git branches + baseline tags in place (see §5).
> The prod EC2 instance was accidentally deleted and is being rebuilt — code is
> safe on GitHub. Cleanup work runs **fully local**; P1/P2 need only
> `python server.py` (no Frappe) — see `CONTRIBUTING.md §6`.

---

## 1. The three pieces

| Component | Repo | Role |
|---|---|---|
| **Frappe / ERPNext v16** | (stock) | Business system of record. MariaDB, site `magnaerp.local`. Only touched via its REST API. |
| **custom_ui** | `github.com/TejasBedarkar/erp_theme` | Frappe app. (a) desk/login theme, (b) hosts the **React AI chat frontend** (`custom_ui/public/js/magna_ai_assistant/`), (c) an **unused** permission-aware API layer (`custom_ui/api/`). |
| **MagmaAssistance** | `github.com/TejasBedarkar/MagmaAssistance` | Standalone FastAPI + LangChain service. The whole AI brain: agent loop, ERP tools, web research, OCR, voice, audit. Entry: `server.py`. |

### How a request actually flows (live path)

```
Browser (React app, loaded from Frappe)
  │  fetch POST https://ai.tjdem.online/api/chat/stream   (SSE)   — NO auth header
  │  or  WebSocket  wss://ai.tjdem.online/ws/voice
  ▼
MagmaAssistance  (EC2, systemd magmaassistance.service, port 8050; LLM_MODEL=gpt-4o)
  server.py : stream_agent_turn()          ← hand-rolled ReAct loop, ≤4 tool rounds
  server.py : _execute_tool()              ← single tool dispatch + audit (SQLite in P2, Postgres today)
  ▼
ERP_Unified/tools.py : erp_data_tool()     ← one generic tool for ANY doctype
  ▼
ERP/erp_client.py : get_list / create_doc / ...   ← Authorization: token <SHARED service account>
  ▼
Frappe REST  /api/resource/<Doctype>  →  MariaDB
```

Non-obvious facts:
- The React app calls MagmaAssistance **directly from the browser**. Frappe only serves the JS bundle.
- **No authentication** on the AI backend. CORS `allow_origins=["*"]`. Every ERP call = one shared service account.
- `session_id` is a client-generated timestamp, not a secret.

---

## 2. Two agent implementations — one is dead

The team ended up with **two** agent systems in `server.py`:

| | **ReAct** (LIVE) | **LangGraph** (DEAD) |
|---|---|---|
| Function | `stream_agent_turn()` (~L1047) | `build_agent_graph()` + `*_node` fns (L1218–1747) |
| Called by | `/api/chat/stream`, `/ws/voice` | `/api/chat`, `/query`, LangGraph Studio |
| Frontend uses it? | **Yes** | **No** — nothing in `custom_ui` calls those endpoints |
| Streaming | Yes (SSE + WS) | No (`ainvoke`, returns one string) |
| Multi-agent | No — one flat loop | Yes — supervisor / research / erp_context / proposal nodes |
| Per-user identity (`use_identity`) | **No — not wired** | Yes (but `session_identities` is never populated, so moot) |
| Memory | conversation only (`stream_history.sqlite`) | + rolling summary, task slots, intent state |

**Why both exist:** LangGraph was built first (matches the original SOW `Magna ERP AI services.md`).
When streaming + voice were needed (Aug 9), the team could not stream through `graph.ainvoke()`,
so they wrote `stream_agent_turn()` as a "streaming twin… so the existing graph is untouched"
(its original docstring). The frontend moved to the streaming endpoint. Three days later the
multi-agent nodes were added — **to the graph the frontend had already left.** Nobody re-merged.

**Decision (2026-09):** keep the single streaming agent. Do **not** revive LangGraph multi-agent.
Port the one thing that matters — a **code-enforced write-approval gate** — into `stream_agent_turn`.
Manufacturing multi-step planner = backlog, not now.

---

## 3. Live vs dead — the map

### KEEP (live, do not break)
- `server.py`: `stream_agent_turn`, `_stream_chat_completion`, `_stream_full_reply`, `_execute_tool`,
  `OpenAIChatModel`, routes `/api/chat/stream` `/ws/voice` `/api/tts*` `/api/upload-*` `/api/audit/*` `/api/health`
- `ERP_Unified/tools.py` — `erp_data_tool`, `erp_describe_fields`, `erp_send_email`, `_run_create`, `_prepare_write_data`
- `ERP/erp_client.py` — **all of it**, including `ERPIdentity` / `use_identity` / `resolve_identity` (orphaned but must be re-wired, not deleted)
- `ERP/dynamic_fields.py`, `ERP/doctype_knowledge.py`
- `LLM/LLM.py` — `LLM` class, `GENERAL_ERP_PROMPT`, `extract_po_data_from_document`, `extract_document_text`
- **audit logging** — the *concept* is kept, but move it to SQLite (see Storage note below + P2)
- `Voice/ws_voice.py`, `TTS/TTS.py`, `TTS/STT.py`, `storage/s3_storage.py`
- `custom_ui/public/js/magna_ai_assistant/` (the React app)
- `custom_ui/api/{metadata,auth,access_control,crud}.py` — **unused today, needed for RBAC. Keep.**

### DEAD — remove (see task P1/P2)
| Item | Location |
|---|---|
| LangGraph nodes + graph | `server.py` `intake_node` `classify_task_node` `summarize_node` `supervisor_node` `web_research_node` `erp_context_node` `proposal_node` `general_node` `execute_pending_node` + routers |
| `generate_reply`, `/api/chat`, `/query`, `build_studio_graph`, `langgraph.json`, `.langgraph_api/` | `server.py`, repo root |
| `IntentOutput`, `_CLASSIFY_SYSTEM`, `text_chain`, `_plain_reply`, graph-only prompts | `server.py`, `LLM/LLM.py` (`INTENT_/RESEARCH_/PROPOSAL_SYSTEM_PROMPT`) |
| `_build_fallback_chart`, `_is_unqualified_approval` | `server.py` — defined, never called |
| `ALL_REQUIRED_FIELDS` / `ALL_FIELD_PARSERS` + their dead branch | `server.py` — permanently `{}` |
| MCP servers | `ERP/mcp_server.py`, `ERP_Unified/mcp_server.py`, `ERP/tools/mcp_tools.py`, `ERP_Unified/mcp_client.py` |
| Unregistered per-doctype tools | `ERP/tools/*_write_tools.py`, `manufacturing_*`, `dynamic_erp_tools.py` — **⚠ keep `ocr_po_tool.py`, `/api/upload-po` uses it** |
| WebRTC / Realtime voice | `useVoiceSession.js`, `AudioCapture.js`, `Voice/openai_stt.py`, `Voice/openai_tts.py`, `Voice/voice_session_manager.py`, `Voice/voice_routes.py` `/api/voice/*` |
| LiveKit | `/api/voice/livekit-token`, `livekit` deps |
| Legacy CLI | `Main.py` (loop), `MagnaCLI.py` |
| Dead env keys | `ELEVENLABS_API_KEY`, `SARVAM_API_KEY` |
| **PostgreSQL audit backend** → replace with SQLite | `db/postgres_audit_log.py` (rewrite on sqlite3), `db/schema.sql`, `db/init_db.py`, `psycopg2-binary` dep, `PG*` env vars, `long_term_memory` + `token_details` tables |
| Old SQLite audit (the real orphan) | `audit_log.py` (repo root) — never imported; harvest its `log_turn`/`get_transcript`/`export_json` as the base for the rewrite |

### DEAD but load-bearing — handle with care
`agent_graph` the compiled object: `load_stream_history` / `save_stream_history` (used by the LIVE path)
reuse its checkpointer (`aget_state`, `aupdate_state(..., as_node="intake")`).
**Before deleting `build_agent_graph`, replace these with a bare `AsyncSqliteSaver` on `stream_history.sqlite`.**

### DORMANT — leave alone for now
- `ERP/tool_rag.py` + `ERP/models/all-MiniLM-L6-v2` — bypassed while tool count ≤ 100. Revisit if tools > 30.

### Nice-to-have (backlog, not in P1–P5)
- `ERP/erp_client.py` sends no `Host` header, so local dev against a multi-site
  bench needs a default site (`bench use magnaerp.local`). Optionally derive a
  `Host` from `ERP_URL` so it works without one.

### Storage — what's actually used (do not confuse)
| Store | Purpose | Status |
|---|---|---|
| SQLite `stream_history.sqlite` (LangGraph `AsyncSqliteSaver`) | Conversation **memory** for the live agent | **Alive, load-bearing** |
| PostgreSQL `magma_audit` (`db/postgres_audit_log.py`) | **Audit trail** — every tool call / reply | Code is wired in, but **only works if a Postgres server runs**; `log_turn()` swallows all errors, so with no Postgres the audit silently writes nothing. **Decision (2026-09): drop Postgres, move audit to SQLite.** |
| SQLite `audit_log.py` (repo root) + `audit_log.db` | Old audit implementation | **Orphan** — imported nowhere, never ran. Reuse its code for the SQLite rewrite. |
| S3-compatible object store (`storage/s3_storage.py`) | Uploaded file bodies | Alive, separate service — safe |

---

## 4. What's missing for the product goal

Goal: *AI operates across the whole ERP while respecting tenant / product / RBAC boundaries.*

| Need | State today |
|---|---|
| User identity browser → AI backend | **Nothing.** `user_id` is always `"anonymous"`. |
| `use_identity()` in the streaming path | Not wired (only in the dead LangGraph path). |
| Per-tenant ERP routing / credentials | None. One `ERP_URL`, one service account. |
| Capability gating (HR customer → only HR tools + doctypes) | None. Everyone gets the full toolset + manufacturing prompt. |
| Write-approval gate enforced in code | Only a prompt instruction + a half-built `_PENDING_CREATES` for web-enriched creates. |

### Tenancy model — DECIDED (2026-09, with management)

**Target state (when sold as SaaS):** one Frappe **site + database per customer** —
`acme.magnaerp.com` / `acme_db`, `beta.magnaerp.com` / `beta_db`, etc. One shared
bench (code) hosts many sites. Physical data isolation; blast radius = one customer;
per-customer upgrades. Cost is infra (RAM/disk grows with sites) + ops (N sites to
back up / patch / monitor).

**For now (current phase):** **single site, customers = ERPNext `Company` records.**
No new infra. Isolation is logical (ERPNext multi-company + permissions), not physical.
Acceptable for pilot / few trusted customers; revisit before arm's-length SaaS sales.

**What this means for P4 — build the capability layer once, portable to both:**
Keep two concerns strictly separate in code:
1. **"Which ERP to connect to"** — one isolated function (`get_erp_client(tenant)`).
   Today: always the single site. Later: look up the customer's site URL + creds. One place changes.
2. **"What can this customer do"** — module list → tool filter → doctype allow-list →
   prompt trim → pre-execution reject. **Identical logic for single-site and multi-site.**
If P4 mixes these, the multi-site migration is painful; if clean, it's a small change.

### Other decisions

- **Realtime/WebRTC voice** — not a product goal for now. Browser Web Speech (free, current)
  is enough. The WebRTC path was removed in P2; can return later if needed.
- **Multi-agent workflow** — settled: single streaming agent + code-enforced write gate
  (both shipped in P1). Manufacturing multi-step planner = backlog.

---

## 5. Baselines & task plan

### Repos, branches, tags

| Repo (remote) | PROD — frozen, no pushes | Cleanup branch | Local-dev branch | Baseline tag |
|---|---|---|---|---|
| **MagmaAssistance** (`origin`) | `beta` @ `b4ec738` | `cleanup/consolidation` ✅ pushed | — | `pre-cleanup-2026-09` ✅ pushed → `b4ec738` |
| **custom_ui / erp_theme** (`upstream`) | `main` @ `76e0268` | *(P3 cuts `feature/identity-wiring` from `main`)* | `dev/local` ✅ pushed | `pre-cleanup-2026-09` ✅ pushed → `76e0268` |

- `frappe` / `erpnext` — stock, unmodified, own release tags. **Not tagged, not touched.**
- **Nobody pushes to `beta` or `main` during the cleanup.** `deploy.yml` fires only on push to `beta`, so freezing `beta` is enough — the workflow file is left in place.
- Prod EC2 instance was accidentally deleted (~2026-09), being rebuilt. Code is safe on GitHub. On rebuild: restore `.env` (all keys); `magma_audit` Postgres + `stream_history.sqlite` were on the box and are gone — acceptable (Postgres is being dropped; chat history is ephemeral). S3 files are safe.

### Tasks

**P0 — Safety net (no production changes)**
- [x] Baseline SHAs captured from GitHub (`b4ec738` / `76e0268`) — EC2 was down, GitHub HEAD is authoritative since deploy = `git pull origin beta`
- [x] `erp_theme` bench clone unshallowed (`git fetch upstream --unshallow`, 150 commits)
- [x] Branches: `cleanup/consolidation` (backend), `dev/local` (frontend) — pushed
- [x] Tags: `pre-cleanup-2026-09` on both repos — pushed
- [x] `ARCHITECTURE.md` + `CONTRIBUTING.md` committed to `cleanup/consolidation`
- [x] Manual smoke: `python server.py` boots, `/api/chat/stream` produces `tool_call`→`tool_result`→`done`, no traceback (ERP call 404 — expected, Frappe not wired locally)
- [ ] Backups: `bench --site magnaerp.local backup --with-files`, secure copy of prod `.env`
- [ ] Turn the §6 smoke curl into a repeatable `smoke.py` on `cleanup/consolidation` — in progress
- [ ] Tell the team: freeze `beta`/`main`, read `ARCHITECTURE.md` + `CONTRIBUTING.md`

**P1 — Agent consolidation** *(~1 wk, after P0)*
- [ ] Replace `load/save_stream_history` graph-checkpointer calls with a bare `AsyncSqliteSaver`
- [ ] Verify multi-turn memory still persists (streaming + voice)
- [ ] Add code-enforced write-approval gate in `_execute_tool` (create/update/submit/send_email → stash + return proposal; next turn "yes" → execute stashed payload deterministically)
- [ ] Delete LangGraph nodes, `generate_reply`, `/api/chat`, `/query`, `build_studio_graph`, `langgraph.json`, graph-only helpers/prompts
- [ ] Re-point or retire `MagnaCLI.py`
- [ ] Re-run smoke tests

**P2 — Dead code removal** *(~4 days, after P1's first commit)*
- [ ] Verify `ocr_po_tool.py` is kept (`/api/upload-po`)
- [ ] Delete MCP files, remaining unregistered `ERP/tools/*`, WebRTC voice path, LiveKit, `_build_fallback_chart`, `_is_unqualified_approval`
- [ ] **Audit → SQLite:** rewrite `db/postgres_audit_log.py` on `sqlite3` (reuse `audit_log.py` root as the base; keep the same public function names so `server.py` call sites don't change). Add the newer functions it needs: `time_tool_call`, `record_file_upload`, `tool_stats`. Delete `db/schema.sql`, `db/init_db.py`, `psycopg2-binary`, all `PG*` env vars, `long_term_memory` + `token_details`. Delete the orphan root `audit_log.py` once harvested.
- [ ] Clean `.env` / `.env.example` / `requirements.txt`
- [ ] Re-run smoke tests

**P3 — Identity wiring** *(~1–1.5 wk, parallel with P1)* — **needs a real local Frappe** (`CONTRIBUTING.md §6`)
- [ ] Frontend sends the Frappe user identity on every request (session cookie / header / token)
- [ ] Backend resolves it on `/api/chat/stream` and `/ws/voice`; wrap `use_identity()` around the turn
- [ ] Lock CORS to the frontend origin
- [ ] Test: different Frappe users → permissions actually enforced
- [ ] Frontend branch `feature/identity-wiring` cut from `main` (not `dev/local` — that only holds the local `API_BASE_URL` tweak)

**P4 — Capability gating (single-site now, multi-site-ready)** *(~2–3 wk, after P3)*
Tenancy is decided (see §4): **single ERPNext site now**, customers = `Company` records;
**one site + DB per customer** is the SaaS target. Build so the switch is a small change.

*Tenant resolution + capability model:*
- [ ] `tenant_of(user)` — resolve the request's tenant (the user's ERPNext `Company`
      now; a customer id later). One function, one source of truth.
- [ ] Tenant registry: `tenant → [purchased modules]` (a table in the audit DB or a
      config file; hot-reloadable, no redeploy to onboard a customer).
- [ ] `modules_for(tenant)` → `allowed_doctypes(tenant)` via a static
      `module → [doctypes]` map (HR → Employee, Leave Application, Attendance…;
      Manufacturing → Work Order, BOM, Job Card…). Built once, not per customer.

*Enforcement (all keyed off `allowed_doctypes`):*
- [ ] Pre-execution check in `_execute_tool` — reject `erp_data_tool` / `erp_send_email`
      calls whose `doctype` isn't in the tenant's allowed set, with a plain message
      ("Manufacturing isn't in your plan"). Runs before the gate/execution.
- [ ] Tool filter — don't bind tools a tenant can't use (mostly relevant for the
      dashboard/web tools; `erp_data_tool` is generic so the doctype check is the real gate).
- [ ] System-prompt trim — strip the module sections (manufacturing pipeline, etc.)
      the tenant didn't buy, so the agent doesn't offer things it can't do.
- [ ] Scope reads — every `erp_data_tool` list/get filtered to the user's `Company`
      (single-site); no-op once each customer has their own site.

*Kept isolated for the multi-site switch:*
- [ ] `get_erp_client(tenant)` — the ONLY place that decides which ERP URL + creds to
      use. Today: always the single site. Later: look up `tenant.site_url`. Nothing
      else in P4 knows about sites.

*Reuse:* `custom_ui/api/auth.py: get_user_allowed_modules()` and
`custom_ui/api/metadata.py` (field-level permission projection) already exist for this.

**P5 — Split oversized files** *(~3–4 days, after P2-audit + P3 merge, before P4)*
Pure refactor, no behaviour change. Run the full smoke suite after **each** module
extracted, not just at the end. First add smoke checks for the write-approval flow
(propose → "yes" → executes) and an audit-row assertion — those are what a refactor
could silently break.

- [ ] **`server.py` (~1,650 lines)** — the one that must be done. Carve into e.g.
      `agent.py` (`stream_agent_turn`, the loop, the write-gate), `routes_chat.py`,
      `routes_voice.py`, `routes_upload.py`, `llm_client.py` (`OpenAIChatModel`),
      `state.py` (module-level `assistant` / `tool_map` / `_PENDING_APPROVALS` /
      `session_identities` / `document_store` / `_checkpoint_conn`), `history.py`
      (`load/save_stream_history`). Watch for circular imports and import-time init order.
- [ ] **`LLM/LLM.py` (~670 lines)** — clean 3-way split: `LLM/prompts.py` (the prompt
      constants), `LLM/client.py` (the `LLM` class), `LLM/vision.py` (all the OCR /
      PO-extraction methods — ~300 lines, fully independent). Drop `run_cli()` or move
      it to `scripts/`.

*Optional, only if the person has spare time — each is one cohesive domain, not urgent:*
- [ ] `web/web_tool.py` (~680) — split the HTML-scraping helpers from the `@tool` defs.
- [ ] `ERP_Unified/tools.py` (~640) — extract `_prepare_write_data` / `_resolve_link_value` /
      `_normalize_filters` into `ERP_Unified/validation.py`. **Core code — touch carefully.**
- [ ] `ERP/tools/project_onboarding_tools.py` (~660) — extract the helpers from the
      `onboard_new_lead` workflow.

*Leave alone:* `ERP/erp_client.py` (~580) — one cohesive class, long is fine.
`db/postgres_audit_log.py` — handled in P2 (audit → SQLite). `MagnaCLI.py` — dev tool.

### Rough timeline
P0 done · **P1 done + merged (2026-09-10)** — checkpointer swap, write-approval gate, LangGraph deletion, `MagnaCLI.py` repointed · P2 ~60% (MCP / unused tools / dead deps merged; audit→SQLite in progress) · P3 identity wiring in review · **order: P2-audit → P3 → P5 → P4** (P5 splits `server.py` etc. so P4's tenant/gating code lands in clean modules; P5 has no P4 dependency)

---

## 6. Reading order for anyone new

1. `server.py` → `stream_agent_turn` (L1047), `_execute_tool` (L879)
2. `ERP_Unified/tools.py` → `erp_data_tool`, `_run_create`
3. `ERP/erp_client.py` → `use_identity`, `_auth_headers`, `resolve_identity`
4. `LLM/LLM.py` → `GENERAL_ERP_PROMPT`
5. `custom_ui/.../AssistantPortal.jsx` → `streamAssistantTurn` + the `/ws/voice` block
6. `custom_ui/api/metadata.py` + `auth.py` — the RBAC building block
7. `db/postgres_audit_log.py` + `audit_log.py` (root) — the audit story (being merged into one SQLite module in P2)
