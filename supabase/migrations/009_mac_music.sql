-- 009: the owner's Mac (aknClient) relays Music.app through startpage. Idempotent.
-- aknClient PUTs now-playing into mac_music (one row) and long-polls mac_music_commands,
-- which the TV fills. Service role only.

CREATE TABLE IF NOT EXISTS mac_music (
  id         INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state      JSONB,                  -- null = Music.app not running
  track_id   TEXT,
  artwork    TEXT,                   -- data:image/jpeg;base64,… of the current track
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE mac_music ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS mac_music_commands (
  id         BIGSERIAL   PRIMARY KEY,
  fn         TEXT        NOT NULL CHECK (fn IN ('play', 'pause', 'resume', 'next', 'previous', 'volume')),
  arg        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  taken_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mac_music_commands_pending ON mac_music_commands (id) WHERE taken_at IS NULL;
ALTER TABLE mac_music_commands ENABLE ROW LEVEL SECURITY;

-- Claims pending commands atomically (two pollers never get the same one).
-- Commands older than 2 minutes are dropped rather than replayed late.
CREATE OR REPLACE FUNCTION claim_mac_music_commands()
RETURNS TABLE (id BIGINT, fn TEXT, arg TEXT)
LANGUAGE sql AS $$
  UPDATE mac_music_commands c SET taken_at = now()
  WHERE c.id IN (
    SELECT p.id FROM mac_music_commands p
    WHERE p.taken_at IS NULL AND p.created_at > now() - interval '2 minutes'
    ORDER BY p.id FOR UPDATE SKIP LOCKED
  )
  RETURNING c.id, c.fn, c.arg;
$$;
REVOKE ALL ON FUNCTION claim_mac_music_commands() FROM PUBLIC, anon, authenticated;
