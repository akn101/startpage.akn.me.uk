-- Additive only: lets external clients (aknClient) upsert their own blocks idempotently.
ALTER TABLE time_sessions ADD COLUMN IF NOT EXISTS source      TEXT;
ALTER TABLE time_sessions ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Plain (non-partial) unique index so PostgREST upsert ON CONFLICT (source, external_id) works.
-- NULLs are distinct in Postgres, so existing rows (source/external_id NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS time_sessions_source_external_id_key
  ON time_sessions (source, external_id);
