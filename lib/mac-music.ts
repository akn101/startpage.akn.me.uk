import { db } from "@/lib/supabase-server";

/** The owner's Music.app, relayed by aknClient on their Mac (see /api/aknclient/music/*). */

export const MAC_FNS = ["play", "pause", "resume", "next", "previous", "volume"] as const;
export type MacFn = (typeof MAC_FNS)[number];
export type MacCommand = { id: number; fn: MacFn; arg: string | null };

/** aknClient heartbeats every 20 s; older than this and the Mac counts as offline. */
export const ONLINE_MS = 60_000;
/** The TV uses the Mac backend once aknClient has reported within this window. */
export const ACTIVE_MS = 7 * 24 * 3600_000;
const MAX_ARTWORK = 400_000; // chars of data URL

export type MacState = {
  title?: string | null; artist?: string | null; album?: string | null;
  playing?: boolean; position?: number | null; duration?: number | null; volume?: number | null;
};

const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function cleanState(v: unknown): MacState | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  return {
    title: str(s.title), artist: str(s.artist), album: str(s.album),
    playing: s.playing === true,
    position: num(s.position), duration: num(s.duration), volume: num(s.volume),
  };
}

export function cleanArtwork(v: unknown): string | null | undefined {
  if (v === undefined) return undefined; // keep the stored one
  if (v === "" || v === null) return null;
  if (typeof v !== "string" || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > MAX_ARTWORK) return undefined;
  return v;
}

export function cleanCommand(fn: unknown, arg: unknown): { fn: MacFn; arg: string | null } | null {
  if (typeof fn !== "string" || !(MAC_FNS as readonly string[]).includes(fn)) return null;
  let a = typeof arg === "string" ? arg.trim().slice(0, 200) : null;
  if (fn === "volume") {
    const n = Number(a);
    if (!Number.isFinite(n)) return null;
    a = String(Math.round(Math.min(100, Math.max(0, n))));
  } else if (fn !== "play") a = null;
  return { fn: fn as MacFn, arg: a || null };
}

export async function saveState(state: MacState | null, trackId: string | null, artwork: string | null | undefined) {
  const row: Record<string, unknown> = { id: 1, state, track_id: trackId, updated_at: new Date().toISOString() };
  if (artwork !== undefined) row.artwork = artwork;
  return db.from("mac_music").upsert([row], { onConflict: "id" });
}

export async function readState(): Promise<{ state: MacState | null; trackId: string | null; artwork: string | null; updatedAt: string } | null> {
  const { data } = await db.from("mac_music").select("state, track_id, artwork, updated_at").eq("id", 1).maybeSingle();
  if (!data) return null;
  return { state: data.state ?? null, trackId: data.track_id ?? null, artwork: data.artwork ?? null, updatedAt: data.updated_at };
}

/** True when aknClient has reported recently enough for the TV to use the Mac. */
export async function macActive(now = Date.now()): Promise<boolean> {
  try {
    const { data } = await db.from("mac_music").select("updated_at").eq("id", 1).maybeSingle();
    return !!data && now - Date.parse(data.updated_at) < ACTIVE_MS;
  } catch { return false; }
}

export async function enqueue(fn: MacFn, arg: string | null) {
  return db.from("mac_music_commands").insert({ fn, arg });
}

export async function claim(): Promise<MacCommand[]> {
  const { data, error } = await db.rpc("claim_mac_music_commands");
  if (error) throw new Error(error.message);
  return ((data ?? []) as MacCommand[]).map((c) => ({ id: Number(c.id), fn: c.fn, arg: c.arg ?? null }));
}
