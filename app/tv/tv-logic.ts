// Pure helpers for the /tv home screen. Ported from the native TV app
// (startpage-tv/native MainActivity.java) so the two read the same.

export type Weather = {
  current: { time: string; temperature_2m: number; weathercode: number; apparent_temperature: number };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weathercode: number[];
    precipitation_probability: (number | null)[];
    uv_index: (number | null)[];
  };
  daily?: { time: string[]; weathercode: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
  _air?: { hourly?: Record<string, (number | null)[] | string[]> };
  _city?: string;
};

export function greeting(hour: number, name?: string): string {
  const g = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${g}, ${name}` : g;
}

export function weatherLabel(c: number): string {
  if (c === 0) return "Clear";
  if (c <= 2) return "Partly cloudy";
  if (c === 3) return "Overcast";
  if (c <= 49) return "Fog";
  if (c <= 57) return "Drizzle";
  if (c <= 67) return "Rain";
  if (c <= 77) return "Snow";
  if (c <= 82) return "Showers";
  if (c <= 86) return "Snow showers";
  return "Thunderstorm";
}

export type GlyphKind = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

export function glyphKind(c: number): GlyphKind {
  if (c === 0) return "clear";
  if (c <= 2) return "partly";
  if (c === 3) return "cloud";
  if (c <= 49) return "fog";
  if (c <= 67 || (c >= 80 && c <= 82)) return "rain";
  if (c <= 86) return "snow";
  return "storm";
}

export const hourOf = (iso: string) => (iso.length >= 16 ? iso.slice(11, 16) : iso);

/** First hourly index at or after the current hour (forecast's own zone). */
export function startIndex(w: Weather): number {
  const nowT = w.current?.time ?? "";
  const times = w.hourly?.time ?? [];
  if (nowT.length >= 13) for (let i = 0; i < times.length; i++) if (times[i] >= nowT.slice(0, 13)) return i;
  return 0;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const POLLEN: [string, string, number][] = [
  ["grass_pollen", "Grass", 30], ["birch_pollen", "Birch", 50], ["alder_pollen", "Alder", 50],
  ["olive_pollen", "Olive", 50], ["mugwort_pollen", "Mugwort", 30], ["ragweed_pollen", "Ragweed", 20],
];

/** Rain, UV, pollen and air quality, each only when it's worth knowing about. Same thresholds as native. */
export function weatherAlerts(w: Weather | null): string[] {
  const out: string[] = [];
  if (!w) return out;
  const nowT = w.current?.time ?? "";
  const h = w.hourly;
  if (h) {
    const times = h.time, rain = h.precipitation_probability, uv = h.uv_index;
    const start = startIndex(w);
    if (times && rain && rain.length > start) {
      const end = Math.min(rain.length, start + 12);
      if (n(rain[start]) >= 50) {
        let dry: string | null = null;
        for (let i = start + 1; i < end; i++) if (n(rain[i]) < 30) { dry = hourOf(times[i]); break; }
        out.push(dry == null ? "Rain on and off all day" : `Rain now, easing by ${dry}`);
      } else {
        for (let i = start + 1; i < end; i++) if (n(rain[i]) >= 50) {
          let peak = 0;
          for (let j = i; j < end; j++) peak = Math.max(peak, n(rain[j]));
          out.push(`Rain likely from ${hourOf(times[i])} (${peak}%)`);
          break;
        }
      }
    }
    if (times && uv) {
      let max = 0, at = -1;
      const today = nowT.length >= 10 ? nowT.slice(0, 10) : "";
      for (let i = start; i < Math.min(uv.length, start + 12); i++) {
        if (!(times[i] ?? "").startsWith(today)) break;
        if (n(uv[i]) > max) { max = n(uv[i]); at = i; }
      }
      if (max >= 6) out.push(`UV ${Math.round(max)}${max >= 8 ? " very high" : " high"}${at > start ? ` around ${hourOf(times[at])}` : " now"}`);
    }
  }
  const ah = w._air?.hourly;
  if (ah) {
    const high: string[] = [];
    for (const [key, label, min] of POLLEN) {
      const a = (ah[key] ?? []) as (number | null)[];
      const max = a.reduce<number>((m, v) => Math.max(m, n(v)), 0);
      if (max >= min) high.push(label);
    }
    if (high.length) out.push(`${high.join(", ")} pollen high`);
    const aqi = (ah.us_aqi ?? []) as (number | null)[];
    const worst = aqi.reduce<number>((m, v) => Math.max(m, Math.trunc(n(v))), 0);
    if (worst > 100) out.push(`${worst > 150 ? "Air unhealthy" : "Air quality poor"} (AQI ${worst})`);
  }
  return out;
}

// ── dates ────────────────────────────────────────────────────────────────

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, k: number) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };

/** "Today", "Tomorrow", a weekday within the week, else "Mon 3 Nov". */
export function dayLabel(d: Date, now = new Date()): string {
  const k = ymd(d);
  if (k === ymd(now)) return "Today";
  if (k === ymd(addDays(now, 1))) return "Tomorrow";
  if (k > ymd(now) && k < ymd(addDays(now, 7))) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** A date-only ISO string ("2026-11-14" or a timestamp) as a local calendar date. */
export function allDayDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const dateOnlyLabel = (iso: string | null | undefined) => (iso && iso.length >= 10 ? dayLabel(allDayDate(iso)) : "");

export const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export function dueLabel(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const s = `${dayLabel(new Date(ms))} ${hhmm(ms)}`;
  return ms < now ? `overdue · ${s}` : s;
}

export function ago(ms: number): string {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

export function money(amount: number, currency: string | undefined, whole: boolean): string {
  const opts: Intl.NumberFormatOptions = { style: "currency", currency: (currency || "GBP").toUpperCase(), maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 };
  try { return new Intl.NumberFormat("en-GB", opts).format(amount); }
  catch { return new Intl.NumberFormat("en-GB", { ...opts, currency: "GBP" }).format(amount); }
}

// ── calendar ─────────────────────────────────────────────────────────────

export type CalEvent = { uid: string; summary: string; start: string; end: string; allDay: boolean; location?: string };

const evStart = (e: CalEvent) => (e.allDay ? allDayDate(e.start).getTime() : Date.parse(e.start));
const evEnd = (e: CalEvent) => {
  if (e.allDay) return addDays(allDayDate(e.start), 1).getTime() - 1; // end of the start date
  const t = Date.parse(e.end || e.start);
  return Number.isFinite(t) ? t : evStart(e);
};

/** Events not yet over, soonest first. */
export function upcoming(events: CalEvent[], now = Date.now()): CalEvent[] {
  return events.filter((e) => evEnd(e) >= now).sort((a, b) => evStart(a) - evStart(b));
}

export function eventSub(e: CalEvent): string {
  const s = evStart(e);
  const when = `${dayLabel(new Date(s))} · ${e.allDay ? "all day" : hhmm(s)}`;
  return e.location ? `${when} · ${e.location}` : when;
}

export function eventRange(e: CalEvent): string {
  if (e.allDay) return "All day";
  const s = evStart(e), en = Date.parse(e.end);
  return Number.isFinite(en) && en > s ? `${hhmm(s)}–${hhmm(en)}` : hhmm(s);
}

export const eventDayKey = (e: CalEvent) => ymd(new Date(evStart(e)));
