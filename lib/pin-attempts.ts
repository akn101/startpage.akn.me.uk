// PIN brute-force lockout, per session. 5 wrong PINs → locked 15 min, then
// 30, 60, … (doubling, capped at 24 h). Stored in Supabase so it holds across
// serverless instances; falls back to process memory if the table is missing.
import { db } from "./supabase-server";

export const MAX_FAILURES = 5;
const BASE_LOCK_MS = 15 * 60_000;
const MAX_LOCK_MS = 24 * 60 * 60_000;

type Row = { key: string; failures: number; lockouts: number; locked_until: string | null };
const mem = new Map<string, Row>();

async function load(key: string): Promise<Row> {
  const { data, error } = await db.from("pin_attempts").select("*").eq("key", key).maybeSingle();
  if (error) {
    console.error("pin_attempts read failed, using memory:", error.message);
    return mem.get(key) ?? { key, failures: 0, lockouts: 0, locked_until: null };
  }
  return (data as Row | null) ?? { key, failures: 0, lockouts: 0, locked_until: null };
}

async function save(row: Row) {
  mem.set(row.key, row);
  const { error } = await db
    .from("pin_attempts")
    .upsert([{ ...row, updated_at: new Date().toISOString() }], { onConflict: "key" });
  if (error) console.error("pin_attempts write failed, kept in memory:", error.message);
}

/** Epoch ms the session is locked out until, or 0. */
export async function lockedUntil(key: string): Promise<number> {
  const r = await load(key);
  const t = r.locked_until ? Date.parse(r.locked_until) : 0;
  return t > Date.now() ? t : 0;
}

/** Record a wrong PIN. Returns { lockedUntil, remaining } after this failure. */
export async function recordFailure(key: string): Promise<{ lockedUntil: number; remaining: number }> {
  const r = await load(key);
  r.failures += 1;
  let until = 0;
  if (r.failures >= MAX_FAILURES) {
    until = Date.now() + Math.min(BASE_LOCK_MS * 2 ** r.lockouts, MAX_LOCK_MS);
    r.lockouts += 1;
    r.failures = 0;
    r.locked_until = new Date(until).toISOString();
  }
  await save(r);
  return { lockedUntil: until, remaining: until ? 0 : MAX_FAILURES - r.failures };
}

export async function clearFailures(key: string) {
  mem.delete(key);
  const { error } = await db.from("pin_attempts").delete().eq("key", key);
  if (error) console.error("pin_attempts clear failed:", error.message);
}
