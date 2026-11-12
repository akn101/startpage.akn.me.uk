// Tiny natural-language date parser for reminders ("journal tomorrow").
// Times are Europe/London; a day without a time means 09:00.

const TZ = "Europe/London";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Offset (minutes) of TZ from UTC at the given instant. */
function tzOffset(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** London calendar date (y, m0, d) for an instant. */
function londonDate(at: Date) {
  const off = tzOffset(at);
  const l = new Date(at.getTime() + off * 60000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate(), dow: l.getUTCDay() };
}

/** The instant of London wall-clock y-m0-d h:min. */
export function londonInstant(y: number, m: number, d: number, h = 9, min = 0): Date {
  const guess = Date.UTC(y, m, d, h, min);
  return new Date(guess - tzOffset(new Date(guess)) * 60000);
}

export type Parsed = { text: string; due: Date | null };

/**
 * Pulls a date phrase off the end (or start) of a reminder:
 *   "journal tomorrow", "call mum on friday 6pm", "pay rent in 3 days",
 *   "tonight take vitamins", "dentist 2026-11-20 14:30".
 * Returns the remaining text and the due instant (null if no phrase found).
 */
export function parseWhen(input: string, now = new Date()): Parsed {
  let s = input.trim().replace(/\s+/g, " ");
  let base: { y: number; m: number; d: number } | null = null;
  let hour: number | null = null;
  let minute = 0;
  let relMs: number | null = null;
  const today = londonDate(now);
  const addDays = (n: number) => {
    const t = new Date(Date.UTC(today.y, today.m, today.d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
  };
  const take = (re: RegExp) => {
    const m = s.match(re);
    if (m) s = (s.slice(0, m.index) + " " + s.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
    return m;
  };

  // time of day: "at 6pm", "18:30", "6:15am"
  const t = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (t) {
    if (t[3]) {
      hour = (+t[1] % 12) + (t[3].toLowerCase() === "pm" ? 12 : 0);
      minute = t[2] ? +t[2] : 0;
    } else {
      hour = +t[4];
      minute = +t[5];
    }
  }

  let m: RegExpMatchArray | null;
  if ((m = take(/\bin\s+(\d{1,3})\s*(min(?:ute)?s?|h(?:ou)?rs?|days?|weeks?)\b/i))) {
    const n = +m[1];
    const u = m[2].toLowerCase();
    if (u.startsWith("min")) relMs = n * 60_000;
    else if (u.startsWith("h")) relMs = n * 3_600_000;
    else base = addDays(u.startsWith("w") ? n * 7 : n);
  } else if ((m = take(/\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/))) {
    base = { y: +m[1], m: +m[2] - 1, d: +m[3] };
  } else if ((m = take(/\btomorrow\b/i))) {
    base = addDays(1);
  } else if ((m = take(/\btonight\b/i))) {
    base = addDays(0);
    if (hour === null) hour = 20;
  } else if ((m = take(/\btoday\b/i))) {
    base = addDays(0);
  } else if ((m = take(/\bnext\s+week\b/i))) {
    base = addDays(7);
  } else if ((m = take(new RegExp(`\\b(?:on\\s+|next\\s+)?(${DAYS.join("|")})\\b`, "i")))) {
    const want = DAYS.indexOf(m[1].toLowerCase());
    let n = (want - today.dow + 7) % 7;
    if (n === 0) n = 7;
    base = addDays(n);
  }

  s = s.replace(/^(?:remind me to|remind me|to)\s+/i, "").trim();
  if (relMs !== null) return { text: s, due: new Date(now.getTime() + relMs) };
  if (!base && hour !== null) {
    base = addDays(0);
    const due = londonInstant(base.y, base.m, base.d, hour, minute);
    if (due <= now) base = addDays(1);
  }
  if (!base) return { text: s, due: null };
  return { text: s, due: londonInstant(base.y, base.m, base.d, hour ?? 9, minute) };
}
