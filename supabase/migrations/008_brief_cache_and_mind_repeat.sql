-- 008: hourly morning-brief cache + repeating Mind reminders. Idempotent.

-- 1. One cached brief per user. The API regenerates it when it is an hour old
--    (or from a previous London day), so the LLM runs about once an hour no
--    matter how many screens are open. Service role only.
CREATE TABLE IF NOT EXISTS brief_cache (
  user_id      TEXT        PRIMARY KEY,
  text         TEXT        NOT NULL,
  ai           BOOLEAN     NOT NULL DEFAULT false,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE brief_cache ENABLE ROW LEVEL SECURITY; -- no policies: service role only

-- 2. Repeating reminders ("journal every day"): ticking one off moves due_at on.
ALTER TABLE mind_items ADD COLUMN IF NOT EXISTS repeat TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mind_items_repeat_check') THEN
    ALTER TABLE mind_items ADD CONSTRAINT mind_items_repeat_check CHECK (repeat IS NULL OR repeat IN ('daily', 'weekly'));
  END IF;
END $$;
