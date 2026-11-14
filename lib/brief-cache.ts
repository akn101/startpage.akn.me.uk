// Morning brief cache: one row per user in `brief_cache` (migration 008).
// The TV and the startpage read the cached brief; it is regenerated when it is
// an hour old or from a previous London day, so the LLM runs at most about
// once an hour however many screens are open. Generation is generate-on-read
// (no cron needed); concurrent readers in one instance share one generation.
import { db } from "./supabase-server";
import { aiBrief, gatherBrief } from "./brief";

export const BRIEF_TTL_MS = 60 * 60_000;
/** A manual refresh is ignored when the brief is younger than this. */
export const BRIEF_MIN_REFRESH_MS = 5 * 60_000;

export type CachedBrief = { text: string; ai: boolean; at: string; nextAt: string };

const londonDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/** Pure: does a brief generated at `generatedAt` need regenerating at `now`? */
export function briefIsStale(generatedAt: string | null | undefined, now = new Date(), ttlMs = BRIEF_TTL_MS): boolean {
  if (!generatedAt) return true;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t) || t > now.getTime() + 60_000) return true;
  if (now.getTime() - t >= ttlMs) return true;
  return londonDay(new Date(t)) !== londonDay(now); // a new day gets a new brief at midnight
}

const inflight = new Map<string, Promise<CachedBrief>>();

const shape = (text: string, ai: boolean, at: string): CachedBrief => ({
  text, ai, at, nextAt: new Date(Date.parse(at) + BRIEF_TTL_MS).toISOString(),
});

export async function getCachedBrief(uid: string, opts: { force?: boolean; now?: Date } = {}): Promise<CachedBrief> {
  const now = opts.now ?? new Date();
  const { data, error } = await db.from("brief_cache").select("text, ai, generated_at").eq("user_id", uid).maybeSingle();
  if (error) console.error("brief cache read:", error.message); // table missing → generate uncached
  const row = data as { text: string; ai: boolean; generated_at: string } | null;
  const age = row ? now.getTime() - Date.parse(row.generated_at) : Infinity;
  const stale = briefIsStale(row?.generated_at, now) || (opts.force && age >= BRIEF_MIN_REFRESH_MS);
  if (row && !stale) return shape(row.text, row.ai, row.generated_at);

  const running = inflight.get(uid);
  if (running) return running;
  const job = (async () => {
    const input = await gatherBrief(uid, now);
    const { text, ai } = await aiBrief(input);
    const at = new Date().toISOString();
    const w = await db.from("brief_cache").upsert([{ user_id: uid, text, ai, generated_at: at }], { onConflict: "user_id" });
    if (w.error) console.error("brief cache write:", w.error.message);
    return shape(text, ai, at);
  })().finally(() => inflight.delete(uid));
  inflight.set(uid, job);
  return job;
}
