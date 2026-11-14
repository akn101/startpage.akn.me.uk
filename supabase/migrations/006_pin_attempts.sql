-- Failed PIN entries per session, for lockout (lib/pin-attempts.ts).
-- Only the server (service role) touches this table.
create table if not exists pin_attempts (
  key text primary key,            -- session key (sid)
  failures int not null default 0, -- failures since the last lockout/success
  lockouts int not null default 0, -- how many times locked out; lockout doubles each time
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table pin_attempts enable row level security;
-- No policies: anon/authenticated roles get nothing; service role bypasses RLS.
