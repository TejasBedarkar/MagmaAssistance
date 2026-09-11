# MagmaAssistance smoke test suite

Drop this folder's contents into the root of `MagmaAssistance/` (alongside
`server.py`). No install step beyond stdlib is required to run the core
suite; `websocket-client` is optional (only needed for `test_voice.py`,
skips cleanly without it).

## Layout

```
smoke_test.py              entry point -- run this
generate_fixtures.py       regenerates test/test_cases/*  (dev-only, needs reportlab + Pillow)
smoke/
  client.py                shared HTTP/SSE client + TestResult type
  fixtures.py               fixture file path helpers
test/
  test_health.py           GET /api/health
  test_chat.py              POST /api/chat/stream (incl. 2-turn memory check)
  test_tool_calls.py        POST /api/chat/stream against a few read-only ERP prompts
  test_ocr.py                POST /api/upload-po        (opt-in -- see WARNING below)
  test_file_reading.py       POST /api/upload-document  (PDF + image only)
  test_voice.py               WS /ws/voice (connect/close only)
  test_audit.py                GET /api/audit/*
  test_dead_code.py            POST /api/chat, /query   (P1 deletion targets)
  test_cases/
    sample.pdf
    sample_po.png
```

## Run it

```bash
python smoke_test.py --port 8050
```

(Check your server's actual startup log for the real port -- `README.md`
in the repo root says 8005, `ARCHITECTURE.md`/`CONTRIBUTING.md` say 8050.
Pass whichever one it actually logs.)

## Flags

| Flag | What it does |
|---|---|
| `--only test_chat test_health` | run just the named modules |
| `--include-ocr` | also runs `test_ocr.py` -- **WARNING:** `/api/upload-po` auto-creates real Supplier/Item/Purchase Order records in ERPNext if the uploaded image looks like a PO. Off by default. |
| `--expect-deleted` | changes `test_dead_code.py`'s assertion: instead of "still reachable (expected)", it now requires `/api/chat` and `/query` to 404/405. Run this *after* the P1 commit that deletes them, as proof the deletion is complete and clean. |

## Before every push (CONTRIBUTING.md §5)

```bash
python smoke_test.py --port 8050
```
Must show `SMOKE TEST PASSED`. If you touched something that changes the
event shape (checkpointer, `_execute_tool`, agent loop), compare this
run's output against a run from before your change.

## Known gaps / things this suite deliberately does NOT cover

- **CSV/XLSX/DOCX file reading** -- doesn't exist in this codebase.
  `/api/upload-document`'s `allowed_types` is PDF/JPEG/PNG only,
  confirmed by grepping for `pandas`/`openpyxl`/`python-docx` (no hits).
  `test_file_reading.py` includes a `rejects_csv` check specifically so
  you'll know if that ever silently changes.
- **Audit endpoints are SQLite-backed.** `server.py` imports
  `db.postgres_audit_log`, which is now a sqlite3 module (module name
  kept for import compatibility) -- no Postgres, no `PG*` env vars.
  `test_audit.py` failing here is a real bug, not a missing-database gap.
- **Write-path ERP tools** (create/update/submit) are not smoke-tested
  here at all, on purpose -- there's no write-approval gate yet (that's
  a P1 checklist item). Add a separate, explicitly-named,
  opt-in-by-default-off module for those once the gate exists.
- **`/ws/voice`** is a connect/close check only -- it doesn't drive an
  actual voice turn end to end.