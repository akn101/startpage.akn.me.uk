// Subsonic-compatible music server (Navidrome, Nextcloud Music, Ampache, Airsonic).
// Credentials stay on the server: the TV only ever sees our own proxy URLs.
// Auth is token + salt (t = md5(password + salt)), API 1.16.1, JSON.
import { createHash, randomBytes } from "node:crypto";

export const SUBSONIC_API = "1.16.1";
export const SUBSONIC_CLIENT = "startpage";

export type Track = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  streamUrl: string;
  duration: number | null;
};

export class SubsonicNotConfigured extends Error {}
export class SubsonicError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
}

const clean = (v: string | undefined) => (v ?? "").replace(/\\n/g, "").trim();

export function subsonicConfigured(): boolean {
  return !!(clean(process.env.SUBSONIC_URL) && clean(process.env.SUBSONIC_USER) && clean(process.env.SUBSONIC_PASSWORD));
}

/** Ids go into our own URL paths and back to the server: keep them boring. */
export const validId = (id: string) => /^[A-Za-z0-9_.:\-]{1,200}$/.test(id);

/** Base URL (without /rest) plus the auth query for one call; a fresh salt each time. */
export function authParams(salt = randomBytes(8).toString("hex")): URLSearchParams {
  if (!subsonicConfigured()) throw new SubsonicNotConfigured();
  const t = createHash("md5").update(clean(process.env.SUBSONIC_PASSWORD) + salt).digest("hex");
  return new URLSearchParams({ u: clean(process.env.SUBSONIC_USER), t, s: salt, v: SUBSONIC_API, c: SUBSONIC_CLIENT, f: "json" });
}

/** e.g. https://music.example.com or https://cloud.example.com/index.php/apps/music/subsonic */
export function endpoint(method: string, params: Record<string, string | number> = {}): string {
  const base = clean(process.env.SUBSONIC_URL).replace(/\/+$/, "").replace(/\/rest$/, "");
  const q = authParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return `${base}/rest/${method}.view?${q}`;
}

async function call(method: string, params: Record<string, string | number> = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(endpoint(method, params), { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (r.status >= 300 && r.status < 400) throw new SubsonicError(`redirected (${r.status}) — an auth gate in front of the server?`);
  if (!r.ok) throw new SubsonicError(`HTTP ${r.status}`);
  const body = await r.json().catch(() => null);
  const res = body?.["subsonic-response"];
  if (!res) throw new SubsonicError("not a Subsonic response");
  if (res.status !== "ok") throw new SubsonicError(res.error?.message ?? "failed", res.error?.code);
  return res;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toTrack(s: any): Track | null {
  const id = s?.id != null ? String(s.id) : "";
  if (!validId(id) || s.isDir || s.isVideo) return null;
  const cover = s.coverArt != null ? String(s.coverArt) : "";
  return {
    id,
    title: String(s.title ?? "Unknown"),
    artist: s.artist ? String(s.artist) : null,
    album: s.album ? String(s.album) : null,
    coverUrl: cover && validId(cover) ? `/api/music/subsonic/cover/${encodeURIComponent(cover)}` : null,
    streamUrl: `/api/music/subsonic/stream/${encodeURIComponent(id)}`,
    duration: typeof s.duration === "number" ? s.duration : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const tracks = (list: unknown): Track[] =>
  (Array.isArray(list) ? list : list ? [list] : []).map(toTrack).filter((t): t is Track => !!t);

export async function search(q: string, limit = 20): Promise<Track[]> {
  const res = await call("search3", { query: q, songCount: limit, albumCount: 0, artistCount: 0 });
  return tracks(res.searchResult3?.song);
}

export async function random(limit = 20): Promise<Track[]> {
  const res = await call("getRandomSongs", { size: limit });
  return tracks(res.randomSongs?.song);
}

export async function ping(): Promise<void> { await call("ping"); }

const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

/** Proxy a binary endpoint (stream / getCoverArt), passing Range through for seeking. */
export async function proxy(method: "stream" | "getCoverArt", params: Record<string, string | number>, req: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  const range = req.headers.get("range");
  if (range && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(range)) headers.range = range;
  const r = await fetch(endpoint(method, params), { headers, cache: "no-store", redirect: "manual" });
  const ct = r.headers.get("content-type") ?? "";
  // Errors come back as a JSON/XML Subsonic envelope with HTTP 200.
  if ((r.status !== 200 && r.status !== 206) || /json|xml/i.test(ct)) {
    void r.body?.cancel().catch(() => {});
    throw new SubsonicError(r.status >= 300 && r.status < 400 ? `redirected (${r.status})` : `upstream ${r.status}`);
  }
  const out = new Headers();
  for (const h of PASS_HEADERS) { const v = r.headers.get(h); if (v) out.set(h, v); }
  if (!out.has("accept-ranges") && method === "stream") out.set("accept-ranges", "bytes");
  out.set("cache-control", method === "getCoverArt" ? "private, max-age=86400" : "private, no-store");
  return new Response(r.body, { status: r.status, headers: out });
}
