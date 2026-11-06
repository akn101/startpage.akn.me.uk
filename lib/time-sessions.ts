import { db } from "@/lib/supabase-server";

export const AKNCLIENT_SOURCE = "aknclient";

export interface WorklogBlock {
  id: string;
  label: string;
  project: string | null;
  started_at: string;
  ended_at: string;
  duration_s: number;
}
export interface WorklogRange { from: string; to: string }

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** Validates a POST /api/aknclient/worklog body. Returns an error string or the parsed value. */
export function parseWorklog(body: unknown): { error: string } | { blocks: WorklogBlock[]; range?: WorklogRange } {
  const b = body as { blocks?: unknown; range?: unknown } | null;
  if (!b || !Array.isArray(b.blocks)) return { error: "blocks must be an array" };
  if (b.blocks.length > 5000) return { error: "too many blocks (max 5000)" };
  const blocks: WorklogBlock[] = [];
  for (const [i, raw] of b.blocks.entries()) {
    const x = raw as Partial<WorklogBlock> | null;
    if (!x || typeof x.id !== "string" || !x.id) return { error: `blocks[${i}].id must be a non-empty string` };
    if (typeof x.label !== "string") return { error: `blocks[${i}].label must be a string` };
    if (x.project != null && typeof x.project !== "string") return { error: `blocks[${i}].project must be a string or null` };
    if (!isIso(x.started_at)) return { error: `blocks[${i}].started_at must be ISO-8601` };
    if (!isIso(x.ended_at)) return { error: `blocks[${i}].ended_at must be ISO-8601` };
    if (typeof x.duration_s !== "number" || !Number.isFinite(x.duration_s) || x.duration_s < 0) {
      return { error: `blocks[${i}].duration_s must be a non-negative number` };
    }
    blocks.push({
      id: x.id, label: x.label, project: x.project ?? null,
      started_at: x.started_at, ended_at: x.ended_at, duration_s: Math.round(x.duration_s),
    });
  }
  let range: WorklogRange | undefined;
  if (b.range != null) {
    const r = b.range as Partial<WorklogRange>;
    if (!isIso(r.from) || !isIso(r.to)) return { error: "range.from and range.to must be ISO-8601" };
    if (Date.parse(r.from) >= Date.parse(r.to)) return { error: "range.from must be before range.to" };
    range = { from: r.from, to: r.to };
  }
  return { blocks, range };
}

/** PostgREST `in` list element: quote and escape so ids with commas/parens are safe. */
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Upserts aknclient blocks into time_sessions (key: source+external_id) as private rows owned by
 * `uid`, then, if a range is given, deletes this uid's aknclient rows that start in [from,to) and
 * are not in the payload. Rows with any other source (or NULL) are never touched.
 */
export async function syncAknclientBlocks(uid: string, blocks: WorklogBlock[], range?: WorklogRange) {
  // Last occurrence of a repeated id wins (a single upsert statement cannot touch a row twice).
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const rows = [...byId.values()].map((b) => ({
    source: AKNCLIENT_SOURCE,
    external_id: b.id,
    label: b.label,
    project: b.project,
    started_at: b.started_at,
    ended_at: b.ended_at,
    duration_s: b.duration_s,
    user_id: uid,
    is_public: false,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("time_sessions")
      .upsert(rows.slice(i, i + 500), { onConflict: "source,external_id" });
    if (error) return { error: error.message };
  }

  let deleted = 0;
  if (range) {
    let q = db.from("time_sessions").delete()
      .eq("source", AKNCLIENT_SOURCE)
      .eq("user_id", uid)
      .gte("started_at", range.from)
      .lt("started_at", range.to);
    if (byId.size > 0) q = q.not("external_id", "in", `(${[...byId.keys()].map(quote).join(",")})`);
    const { data, error } = await q.select("id");
    if (error) return { error: error.message };
    deleted = data?.length ?? 0;
  }
  return { upserted: rows.length, deleted };
}
