// TV dashboard config. The TV app is generic: anyone can install it and gets
// the guest dashboard (public modules only). Entering the owner's PIN on a TV
// unlocks the owner's profile. The module lists are server-side config, not
// app code; override with STARTPAGE_TV_MODULES='{"guest":[...],"owner":[...]}'.

export type TvProfile = "guest" | "owner";

export const DEFAULT_TV_MODULES: Record<TvProfile, string[]> = {
  guest: ["clock", "weather"],
  owner: ["weather", "calendar", "brief", "todos", "mind", "github", "money", "ask"],
};

const MODULE_ID = /^[a-z][a-z0-9_-]{0,31}$/;

export function tvModules(env = process.env.STARTPAGE_TV_MODULES): Record<TvProfile, string[]> {
  if (!env) return DEFAULT_TV_MODULES;
  try {
    const o = JSON.parse(env) as Partial<Record<TvProfile, unknown>>;
    const pick = (v: unknown, d: string[]) =>
      Array.isArray(v) && v.every((m) => typeof m === "string" && MODULE_ID.test(m)) ? (v as string[]) : d;
    return { guest: pick(o.guest, DEFAULT_TV_MODULES.guest), owner: pick(o.owner, DEFAULT_TV_MODULES.owner) };
  } catch {
    console.error("tv-config: STARTPAGE_TV_MODULES is not valid JSON; using defaults");
    return DEFAULT_TV_MODULES;
  }
}

/** Optional allowlist of TV install ids (X-Startpage-Device) that may PIN-unlock the owner profile. Unset = any TV. */
export function tvDeviceAllowed(device: string | null, env = process.env.STARTPAGE_TV_DEVICES): boolean {
  const list = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return !!device && list.includes(device.trim());
}

/** Short, log-safe form of a device id. */
export const deviceTag = (d: string | null) => (d ? d.replace(/[^\w.-]/g, "").slice(0, 16) || "?" : "-");

export type TvLocation = { lat: number; lon: number; name: string };

/** Where the TV is, for weather/clock (its IP geolocates wrongly over VPN). STARTPAGE_TV_LOCATION='{"lat":..,"lon":..,"name":".."}'. */
export function tvLocation(env = process.env.STARTPAGE_TV_LOCATION): TvLocation | null {
  if (!env) return null;
  try {
    const o = JSON.parse(env) as Partial<TvLocation>;
    const lat = Number(o.lat), lon = Number(o.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, name: typeof o.name === "string" ? o.name.slice(0, 60) : "" };
  } catch {
    return null;
  }
}
