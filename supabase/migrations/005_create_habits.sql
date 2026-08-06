-- Daily habits with per-day completion logs.
--
-- `day` is a DATE, not a timestamp: a habit is done for a calendar day or it
-- isn't, and storing an instant would make streaks depend on the timezone the
-- request happened to come from. The client sends its own local date.

CREATE TABLE IF NOT EXISTS habits (
  id          UUID                     DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT,
  name        TEXT                     NOT NULL,
  active      BOOLEAN                  DEFAULT true,
  sort        INTEGER                  DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id          UUID                     DEFAULT gen_random_uuid() PRIMARY KEY,
  habit_id    UUID                     NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id     TEXT,
  day         DATE                     NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (habit_id, day)
);

CREATE INDEX IF NOT EXISTS habit_logs_habit_day_idx ON habit_logs (habit_id, day DESC);

-- RLS: personal tool, all access goes through server routes using the service
-- role key, which scope every query by user_id. Matches todos/time_sessions.
ALTER TABLE habits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON habits;
CREATE POLICY "allow_all" ON habits FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all" ON habit_logs;
CREATE POLICY "allow_all" ON habit_logs FOR ALL USING (true) WITH CHECK (true);
