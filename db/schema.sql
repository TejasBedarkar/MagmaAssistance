-- =====================================================================
-- MagmaAssistance -- PostgreSQL Audit Log + File Storage Schema
-- =====================================================================
-- Replaces the SQLite-backed audit_log.py with a proper Postgres schema.
-- Safe to run multiple times (idempotent: IF NOT EXISTS / DO blocks).
--
-- Design notes:
--   * sessions        -- one row per chat/thread session
--   * audit_log       -- one row per turn: user message, assistant reply,
--                        or tool call. Captures who asked, which tool was
--                        picked, what it returned, and how long it took.
--   * file_uploads    -- one row per uploaded file (PO/OCR or general doc),
--                        with S3 location + who uploaded it and when.
--
-- Run with: psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -f db/schema.sql
-- or via:   python db/init_db.py
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Enum types (created idempotently -- CREATE TYPE has no IF NOT EXISTS)
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'turn_role') THEN
        CREATE TYPE turn_role AS ENUM ('user', 'assistant', 'tool', 'system');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tool_status') THEN
        CREATE TYPE tool_status AS ENUM ('success', 'error', 'not_found');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upload_kind') THEN
        CREATE TYPE upload_kind AS ENUM ('purchase_order', 'general_document', 'audio');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upload_status') THEN
        CREATE TYPE upload_status AS ENUM ('pending', 'processing', 'processed', 'failed');
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- sessions -- one row per conversation thread
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT PRIMARY KEY,
    user_id         TEXT,                                    -- who owns/started this session
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,       -- free-form (client, ip, channel, etc.)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions (last_active_at DESC);

-- ---------------------------------------------------------------------
-- audit_log -- one row per user message / assistant reply / tool call
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id                BIGSERIAL PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,

    role              turn_role NOT NULL,           -- 'user' | 'assistant' | 'tool' | 'system'
    user_id           TEXT,                         -- who prompted the question (for role='user';
                                                      -- carried through to the tool/assistant rows
                                                      -- that answer the same request)
    prompt_text       TEXT,                         -- the user question that triggered this row
                                                      -- (denormalized onto tool/assistant rows too,
                                                      -- so "who asked for this tool call" is a
                                                      -- single-row lookup, no self-join needed)

    content           TEXT NOT NULL,                 -- message text / tool result (stringified)

    tool_name         TEXT,                          -- which tool was selected (NULL for user/assistant)
    tool_args         JSONB,                         -- arguments passed to the tool
    tool_status       tool_status,                   -- outcome of the tool call
    error_message     TEXT,                          -- populated when tool_status = 'error'

    duration_ms       INTEGER,                       -- wall-clock time taken to produce this row
                                                      -- (LLM latency for assistant rows, tool
                                                      -- execution time for tool rows)

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_session      ON audit_log (session_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at   ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_tool_name    ON audit_log (tool_name) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id      ON audit_log (user_id) WHERE user_id IS NOT NULL;
-- Fast "everything ERP-write-tool X did last week" type queries
CREATE INDEX IF NOT EXISTS idx_audit_log_tool_created ON audit_log (tool_name, created_at DESC);

-- ---------------------------------------------------------------------
-- file_uploads -- metadata for every file uploaded, content lives in S3
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_uploads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          TEXT REFERENCES sessions (session_id) ON DELETE SET NULL,
    user_id             TEXT,                        -- who uploaded the file
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    original_filename   TEXT NOT NULL,
    content_type        TEXT NOT NULL,
    file_size_bytes     BIGINT NOT NULL CHECK (file_size_bytes >= 0),
    checksum_sha256     TEXT NOT NULL,                -- de-dupe / integrity check

    upload_kind         upload_kind NOT NULL,         -- purchase_order | general_document | audio
    status              upload_status NOT NULL DEFAULT 'pending',

    s3_bucket           TEXT NOT NULL,
    s3_key              TEXT NOT NULL,
    s3_region           TEXT NOT NULL,
    s3_version_id       TEXT,                         -- set if bucket versioning is enabled

    extracted_metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- OCR result / page count / etc.
    processing_error    TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (s3_bucket, s3_key)
);

CREATE INDEX IF NOT EXISTS idx_file_uploads_session   ON file_uploads (session_id);
CREATE INDEX IF NOT EXISTS idx_file_uploads_user      ON file_uploads (user_id);
CREATE INDEX IF NOT EXISTS idx_file_uploads_uploaded  ON file_uploads (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_uploads_checksum  ON file_uploads (checksum_sha256);

-- Keep updated_at current on any row change (e.g. status pending -> processed)
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_file_uploads_touch ON file_uploads;
CREATE TRIGGER trg_file_uploads_touch
    BEFORE UPDATE ON file_uploads
    FOR EACH ROW
    EXECUTE FUNCTION touch_updated_at();

COMMIT;
