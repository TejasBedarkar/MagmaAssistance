# ERP_Unified (Work in Progress)

Single-tool ERPNext integration. Instead of one hand-written tool per
doctype/action (the approach in `ERP/tools/*`), this folder exposes one
generic tool, `erp_data_tool`, that takes `operation` + `doctype` +
`data`/`filters` and works against any ERPNext doctype.

Status: new, not wired into `server.py` / `ERP/tools/__init__.py` yet,
and not yet tested against a live ERPNext instance. The original `ERP/`
folder is untouched and still the one actually used by the app.

Files:
- `tools.py` — LangChain `@tool` version (`ERP_UNIFIED_TOOLS`) for direct import.
- `mcp_server.py` — same tool exposed over MCP (stdio or `--http` on :8101).
- `mcp_client.py` — client-side bridge to spawn/connect to `mcp_server.py`.

Supported operations: `list`, `get`, `create`, `update`, `submit`.
Delete/cancel/remove operations are blocked at the tool level and are
not implemented in `ERP/erp_client.py` either — there is no code path
in this project that can delete an ERPNext record.

## Dynamic field discovery + one-by-one slot filling

Because `erp_data_tool` works against ANY doctype, it can't rely on a
hand-maintained required-fields list per doctype the way
`ERP/tools/sales_write_tools.py` etc. do for their fixed set of
doctypes. Instead, `create` reads the doctype's field definitions
straight from ERPNext's own schema at call time
(`ERP.dynamic_fields.get_required_fields()`, backed by
`erp_client.get_meta()` — `GET /api/resource/DocType/<doctype>`).

Flow:
1. Call `erp_data_tool(operation='create', doctype=..., data={...})`
   with whatever fields are already known (`data` can be partial or
   omitted).
2. If ERPNext's schema says something required is still missing, the
   tool does NOT fail — it returns exactly one question for the next
   missing field, e.g. `field: lead_name`, and remembers what's been
   collected so far under `session_id`.
3. Ask the user that one question, then call `erp_data_tool` again with
   the same `doctype`/`session_id` and the answer added to `data`.
   Repeat until every required field is filled, at which point it
   actually creates the record in ERPNext.

Call `erp_describe_fields(doctype)` any time to see the full list of
currently-required fields for a doctype up front (e.g. to answer "what
do you need to create a Sales Order?") without starting a create.

Any ERPNext error along the way (missing field, bad Link value,
duplicate record, permission problem, ERPNext unreachable, dev-server
417, etc.) is turned into a plain-language explanation via
`ERP.dynamic_fields.explain_erp_error()` instead of a raw exception
string, so the user gets something they can act on.

The in-progress-create store (`_PENDING_CREATES`) is in-memory per
process, same tradeoff as `ERP/server.py`'s `MemorySaver` checkpointer
— it resets on restart.
