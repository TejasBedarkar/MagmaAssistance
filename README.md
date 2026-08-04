run setup_run.bat to download requirements also better use 3.10-3.12 python version
source venv/bin/activate
python server.py --port 8005

---

This is a merge of two prior branches — see `MERGE_NOTES.md` for the
full breakdown. In short: this uses the generic `erp_data_tool` CRUD
layer from `ERP_Unified/` (works against any ERPNext doctype, no custom
Frappe app needed) plus a per-user authentication layer ported in from
an earlier branch, so each chat session can be bound to a real ERPNext
user's own credentials via `POST /api/session/identify` instead of one
shared service account. Copy `.env.example` to `.env` and fill in your
ERPNext + LLM + Postgres settings before running.
