# Magna AI — Architecture & Cleanup Plan

> Status: **inherited system, under review.** This file is the source of truth for
> what is live, what is dead, and what we are changing. Update it as work lands.
> Written from a read-only code investigation (2026-09-04).

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
MagmaAssistance  (EC2, systemd magmaassistance.service, port 8050)
  server.py : stream_agent_turn()          ← hand-rolled ReAct loop, ≤4 tool rounds
  server.py : _execute_tool()              ← single tool dispatch + Postgres audit
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

**Open decisions (product owner):**
1. Tenancy: separate Frappe site per customer, or one site with company segregation?
2. Realtime/WebRTC voice — product goal, or is browser Web Speech (free, current) enough?

---

## 5. Baselines & task plan

### Production baseline
| Repo | Prod branch | Baseline commit (GitHub HEAD, 2026-09-04) | Tag |
|---|---|---|---|
| MagmaAssistance | `beta` (auto-deploy via `.github/workflows/deploy.yml` → EC2) | `b4ec738f182c409ed97e719f3811f124cbcf6461` (Aug 26 — unchanged since) | `pre-cleanup-2026-09` (pending) |
| custom_ui / erp_theme | `main` (deployed to the Frappe server) | `76e0268e938d373f3214dc95127d9cc0ed2f5b19` (Aug 31) | `pre-cleanup-2026-09` (pending) |

> Note: the MagmaAssistance EC2 instance was accidentally deleted (~2026-09) and is being rebuilt.
> The **code** baseline is safe (matches GitHub `beta` HEAD above). On rebuild, verify:
> `.env` restored (all API keys), whether Postgres `magma_audit` was on the instance (`PGHOST=localhost` → audit history lost),
> `stream_history.sqlite` was on the instance → conversation history lost. S3 file storage is separate and safe.

### Tasks

**P0 — Safety net (no code changes)**
- [ ] Get prod HEAD + `git status` from EC2 and the Frappe server → fill the table above
- [ ] Full clone of `erp_theme` (current bench clone is shallow, 1 commit)
- [ ] Disable `deploy.yml` (or move all cleanup to a branch + staging) so nothing auto-ships mid-cleanup
- [ ] Backups: copy `stream_history.sqlite`, `bench backup --with-files`, secure copy of `.env` (Postgres `magma_audit` likely already lost with the EC2 instance — see §5 note)
- [ ] Smoke-test script: hits every live endpoint + each tool once, checks a turn is recorded
- [ ] Tag both baselines (can be done now — SHAs known; does not need the server)
- [ ] Run the full stack locally: `bench start` (Frappe :8000) + `venv/bin/python server.py` (:8050); set `ChatArea.jsx` `API_BASE_URL` to `http://localhost:8050` for dev

**P1 — Agent consolidation** *(Dev A, senior, ~1 wk, after P0)*
- [ ] Replace `load/save_stream_history` graph-checkpointer calls with a bare `AsyncSqliteSaver`
- [ ] Verify multi-turn memory still persists (streaming + voice)
- [ ] Add code-enforced write-approval gate in `_execute_tool` (create/update/submit/send_email → stash + return proposal; next turn "yes" → execute stashed payload deterministically)
- [ ] Delete LangGraph nodes, `generate_reply`, `/api/chat`, `/query`, `build_studio_graph`, `langgraph.json`, graph-only helpers/prompts
- [ ] Re-point or retire `MagnaCLI.py`
- [ ] Re-run smoke tests

**P2 — Dead code removal** *(Dev B, ~4 days, after P1's first commit)*
- [ ] Verify `ocr_po_tool.py` is kept (`/api/upload-po`)
- [ ] Delete MCP files, remaining unregistered `ERP/tools/*`, WebRTC voice path, LiveKit, `_build_fallback_chart`, `_is_unqualified_approval`
- [ ] **Audit → SQLite:** rewrite `db/postgres_audit_log.py` on `sqlite3` (reuse `audit_log.py` root as the base; keep the same public function names so `server.py` call sites don't change). Add the newer functions it needs: `time_tool_call`, `record_file_upload`, `tool_stats`. Delete `db/schema.sql`, `db/init_db.py`, `psycopg2-binary`, all `PG*` env vars, `long_term_memory` + `token_details`. Delete the orphan root `audit_log.py` once harvested.
- [ ] Clean `.env` / `.env.example` / `requirements.txt`
- [ ] Re-run smoke tests

**P3 — Identity wiring** *(Dev C, senior, ~1–1.5 wk, parallel with P1)*
- [ ] Frontend sends the Frappe user identity on every request (session cookie / header / token)
- [ ] Backend resolves it on `/api/chat/stream` and `/ws/voice`; wrap `use_identity()` around the turn
- [ ] Lock CORS to the frontend origin
- [ ] Test: different Frappe users → permissions actually enforced

**P4 — Tenancy + capability gating** *(senior, ~2–3 wk, after P3 + decision #1)*
- [ ] Per-tenant ERP routing
- [ ] Filter tools + doctypes by the customer's purchased modules (`get_user_allowed_modules`)
- [ ] Pre-execution permission check in `_execute_tool`
- [ ] Trim the system prompt per tenant

**P5 — Split `server.py`** *(Dev B, ~3 days, low priority, after P1+P2)*
- [ ] Carve 2,100-line `server.py` into `agent.py` / `routes_*.py` / `llm_client.py` — pure refactor

### Rough timeline
Week 1: P0 · Weeks 2–3: P1 + P3 (parallel), P2 follows P1 · Weeks 4–7: P4

---

## 6. Reading order for anyone new

1. `server.py` → `stream_agent_turn` (L1047), `_execute_tool` (L879)
2. `ERP_Unified/tools.py` → `erp_data_tool`, `_run_create`
3. `ERP/erp_client.py` → `use_identity`, `_auth_headers`, `resolve_identity`
4. `LLM/LLM.py` → `GENERAL_ERP_PROMPT`
5. `custom_ui/.../AssistantPortal.jsx` → `streamAssistantTurn` + the `/ws/voice` block
6. `custom_ui/api/metadata.py` + `auth.py` — the RBAC building block
7. `db/schema.sql` + `db/postgres_audit_log.py`
