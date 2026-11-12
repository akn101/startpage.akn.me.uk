-- 1. Lock down: the app only talks to Supabase with the service-role key
--    (server side, bypasses RLS). The old allow_all policies let anyone with
--    the anon key read and write these tables. Drop them; RLS stays on.
DROP POLICY IF EXISTS "allow_all" ON todos;
DROP POLICY IF EXISTS "allow_all" ON time_sessions;
DROP POLICY IF EXISTS "allow_all" ON photos;

-- 2. Mind: what people want for you, things on your mind, reminders.
CREATE TABLE IF NOT EXISTS mind_items (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          TEXT        NOT NULL,
  kind             TEXT        NOT NULL CHECK (kind IN ('wish', 'thought', 'reminder')),
  text             TEXT        NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  person           TEXT        CHECK (person IS NULL OR length(person) <= 200),
  bonds_contact_id TEXT,
  due_at           TIMESTAMPTZ,
  done             BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mind_items_user_kind ON mind_items (user_id, kind, done);
ALTER TABLE mind_items ENABLE ROW LEVEL SECURITY; -- no policies: service role only
