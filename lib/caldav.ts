import ICAL from "ical.js";

const cfg = () => ({
  url:  process.env.CALDAV_URL ?? "",
  user: process.env.CALDAV_USERNAME ?? "",
  pass: process.env.CALDAV_PASSWORD ?? "",
});

function basicAuth() {
  return "Basic " + Buffer.from(`${cfg().user}:${cfg().pass}`).toString("base64");
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Calendar exclusion (tracker calendars) ─────────────────────────────────
export const DEFAULT_EXCLUDED_CALENDARS = ["worklog", "Location Tracking", "Siri Suggestions", "Scheduled Reminders"];

export function excludedCalendars(): string[] {
  const raw = process.env.STARTPAGE_CALENDAR_EXCLUDE;
  const list = raw !== undefined && raw.trim() !== ""
    ? raw.split(",")
    : DEFAULT_EXCLUDED_CALENDARS;
  return list.map((n) => n.trim().toLowerCase()).filter(Boolean);
}

export function isExcludedCalendar(name: string, excluded = excludedCalendars()): boolean {
  return excluded.includes(name.trim().toLowerCase());
}

// ── Discover calendar collections via PROPFIND ─────────────────────────────
export interface CalendarCollection { path: string; name: string }

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Parse a PROPFIND multistatus, one <response> at a time. */
export function parseCalendarCollections(xml: string, basePath: string): CalendarCollection[] {
  const out: CalendarCollection[] = [];
  const respRe = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = respRe.exec(xml)) !== null) {
    const block = m[1];
    const href = block.match(/<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i)?.[1];
    if (!href) continue;
    const rt = block.match(/<(?:[\w-]+:)?resourcetype\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?resourcetype>/i)?.[1] ?? "";
    // Real calendar collections only: <calendar/>, not schedule-inbox/outbox/notification
    if (!/<(?:[\w-]+:)?calendar\s*\/?>/i.test(rt)) continue;
    const path = decodeXml(href.trim());
    if (!path.endsWith("/")) continue;
    if (path === basePath && !/<(?:[\w-]+:)?calendar\s*\/?>/i.test(rt)) continue;
    const dn = block.match(/<(?:[\w-]+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?displayname>/i)?.[1] ?? "";
    out.push({ path, name: decodeXml(dn).trim() });
  }
  return out;
}

async function discoverCalendars(): Promise<CalendarCollection[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;

  const res = await fetch(cfg().url, {
    method: "PROPFIND",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
    },
    body,
  });

  if (!res.ok) return [];
  const xml = await res.text();
  return parseCalendarCollections(xml, new URL(cfg().url).pathname);
}

// ── Fetch events from a single calendar via REPORT ─────────────────────────
async function fetchCalendarEvents(calPath: string, days: number): Promise<{ ok: boolean; blocks: string[] }> {
  // Start at midnight, not "now" — otherwise today's all-day events (which are
  // stamped 00:00) fall outside the window as soon as the day starts.
  // Recurring masters are matched by the server's own expansion of the range.
  const now       = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const weekAhead = new Date(now.getTime() + days * DAY_MS);
  const fmt       = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const origin = new URL(cfg().url).origin;
  const url    = `${origin}${calPath}`;

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fmt(now)}" end="${fmt(weekAhead)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const res = await fetch(url, {
    method: "REPORT",
    headers: {
      Authorization:  basicAuth(),
      "Content-Type": "application/xml; charset=utf-8",
      Depth:          "1",
    },
    body,
  });

  if (!res.ok) {
    console.error(`CalDAV REPORT ${calPath} → ${res.status} ${res.statusText}`);
    return { ok: false, blocks: [] };
  }
  const xml = await res.text();

  // Extract calendar-data sections
  const icsBlocks: string[] = [];
  const re = /<(?:[\w-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calendar-data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    icsBlocks.push(decodeXml(m[1].trim()));
  }
  return { ok: true, blocks: icsBlocks };
}

// ── iCal parsing + expansion ───────────────────────────────────────────────
export interface CalEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  location?: string;
  joinUrl?: string;
}

const MAX_ITERATIONS = 5000;

function validTz(tzid: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tzid }); return true; } catch { return false; }
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(utcMs / 1000) * 1000;
}

/** Wall-clock fields in an IANA zone → UTC ms (DST-gap safe enough: second pass). */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

/** Zone used for floating times (no TZID, no Z). Default: the server's zone. */
function floatingZone(): string | null {
  const z = process.env.STARTPAGE_CALENDAR_TZ;
  return z && validTz(z) ? z : null;
}

/** Convert an ICAL.Time (any zone kind) to UTC epoch ms. */
function toUtcMs(t: ICAL.Time): number {
  if (t.isDate) return Date.UTC(t.year, t.month - 1, t.day);
  const tzid = t.zone?.tzid;
  if (!tzid || tzid === "UTC" || tzid === "Z") return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (tzid === "floating") {
    const fz = floatingZone();
    if (fz) return wallToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, fz);
    return new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second).getTime();
  }
  if (validTz(tzid)) return wallToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid);
  return t.toUnixTime() * 1000; // custom VTIMEZONE (registered)
}

function registerTimezones(root: ICAL.Component) {
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    const tzid = vtz.getFirstPropertyValue("tzid") as string | null;
    if (!tzid || validTz(tzid)) continue; // IANA names are resolved through Intl
    try {
      const tz = new ICAL.Timezone(vtz);
      ICAL.TimezoneService.register(tz);
    } catch { /* ignore broken VTIMEZONE */ }
  }
}

/** Fix a property whose TZID is IANA but unknown to ical.js: keep tzid on the time. */
function withTzid(time: ICAL.Time, tzid: string | undefined): ICAL.Time {
  if (!tzid || time.isDate || time.zone?.tzid === tzid) return time;
  if (time.zone && time.zone.tzid !== "floating") return time;
  const fixed = time.clone();
  fixed.zone = { tzid } as unknown as ICAL.Timezone;
  return fixed;
}

function propTzid(ve: ICAL.Component, name: string): string | undefined {
  const p = ve.getFirstProperty(name);
  const t = p?.getParameter("tzid");
  return typeof t === "string" ? t : undefined;
}

function cleanText(v: string): string {
  return v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function joinUrlOf(ve: ICAL.Component): string | undefined {
  const url = ve.getFirstPropertyValue("url");
  if (url) return String(url).trim();
  const g = ve.getFirstPropertyValue("x-google-conference");
  if (g) return String(g).trim();
  const desc = ve.getFirstPropertyValue("description");
  if (typeof desc === "string") {
    const match = desc.match(/https?:\/\/(?:[^\s\\]+\.)?(?:teams\.microsoft\.com|meet\.google\.com|zoom\.us|whereby\.com|webex\.com)[^\s\\]*/i);
    if (match) return match[0].trim();
  }
  return undefined;
}

interface Win { fromMs: number; toMs: number; now: number; dayStartMs: number }

/**
 * Parse the ICS blocks of one calendar and expand every occurrence that is
 * still relevant: timed events that have not ended and start before `toMs`,
 * all-day events from today (UTC midnight) on.
 */
export function expandIcsBlocks(blocks: string[], calendar: string, win: Win): CalEvent[] {
  const out: CalEvent[] = [];

  for (const ics of blocks) {
    let root: ICAL.Component;
    try {
      root = new ICAL.Component(ICAL.parse(ics));
    } catch (err) {
      console.error("CalDAV: unparseable ICS block", err);
      continue;
    }
    registerTimezones(root);

    // Group VEVENTs by UID: master + RECURRENCE-ID overrides
    const byUid = new Map<string, { master?: ICAL.Component; overrides: ICAL.Component[] }>();
    for (const ve of root.getAllSubcomponents("vevent")) {
      const uid = ve.getFirstPropertyValue("uid");
      if (typeof uid !== "string") continue;
      const g = byUid.get(uid) ?? { overrides: [] };
      if (ve.hasProperty("recurrence-id")) g.overrides.push(ve); else g.master = g.master ?? ve;
      byUid.set(uid, g);
    }

    for (const [uid, g] of byUid) {
      const base = g.master ?? g.overrides[0];
      if (!base) continue;

      const mkEvent = (ve: ICAL.Component, startT: ICAL.Time, endT: ICAL.Time | null, recurring: boolean): void => {
        if (String(ve.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
        const summaryRaw = ve.getFirstPropertyValue("summary");
        if (typeof summaryRaw !== "string" || !summaryRaw) return;
        const allDay = startT.isDate;
        const startMs = toUtcMs(startT);
        let endMs: number;
        if (endT) endMs = toUtcMs(endT);
        else endMs = allDay ? startMs + DAY_MS : startMs;
        if (endMs < startMs) endMs = startMs;

        if (startMs > win.toMs) return;
        if (allDay) { if (endMs <= win.dayStartMs) return; }
        else if (endMs <= win.now && !(endMs === startMs && startMs >= win.now - 60_000)) return;

        const location = ve.getFirstPropertyValue("location");
        const ev: CalEvent = {
          uid: recurring ? `${uid}@${new Date(startMs).toISOString()}` : uid,
          summary: cleanText(summaryRaw),
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          allDay,
          calendar,
        };
        if (typeof location === "string" && location) ev.location = location;
        const join = joinUrlOf(ve);
        if (join) ev.joinUrl = join;
        out.push(ev);
      };

      const dtstartProp = base.getFirstProperty("dtstart");
      if (!dtstartProp) continue;
      const startOf = (ve: ICAL.Component) => withTzid(ve.getFirstPropertyValue("dtstart") as ICAL.Time, propTzid(ve, "dtstart"));
      const endOf = (ve: ICAL.Component): ICAL.Time | null => {
        const e = ve.getFirstPropertyValue("dtend") as ICAL.Time | null;
        return e ? withTzid(e, propTzid(ve, "dtend") ?? propTzid(ve, "dtstart")) : null;
      };

      try {
        if (g.master && g.master.hasProperty("rrule")) {
          // Duration of the master in real time, applied to each occurrence
          const mStart = startOf(g.master);
          const mEnd = endOf(g.master);
          const durMs = mEnd ? toUtcMs(mEnd) - toUtcMs(mStart) : (mStart.isDate ? DAY_MS : 0);
          const overridden = new Set<string>();
          for (const o of g.overrides) {
            const rid = o.getFirstPropertyValue("recurrence-id") as ICAL.Time;
            overridden.add(String(toUtcMs(withTzid(rid, propTzid(o, "recurrence-id")))));
          }

          // Iterate the master's own rule; apply overrides at their recurrence-id
          const iter = new ICAL.Event(g.master).iterator();
          let n = 0;
          for (let next = iter.next(); next && n < MAX_ITERATIONS; next = iter.next(), n++) {
            const t = withTzid(next, propTzid(g.master, "dtstart"));
            const ms = toUtcMs(t);
            if (ms > win.toMs) break;
            if (overridden.has(String(ms))) continue; // replaced below
            const startT = t;
            let endT: ICAL.Time | null = null;
            let endOverride: number | null = null;
            if (mEnd) endOverride = ms + durMs;
            if (endOverride !== null) {
              if (startT.isDate) { endT = startT.clone(); endT.adjust(Math.round(durMs / DAY_MS), 0, 0, 0); }
              else { endT = ICAL.Time.fromJSDate(new Date(endOverride), true); }
            }
            mkEvent(g.master, startT, endT, true);
          }
          for (const o of g.overrides) mkEvent(o, startOf(o), endOf(o), true);
        } else {
          // Single event (or orphan override whose master is outside the range)
          mkEvent(base, startOf(base), endOf(base), base.hasProperty("recurrence-id"));
          for (const o of g.overrides) if (o !== base) mkEvent(o, startOf(o), endOf(o), true);
        }
      } catch (err) {
        console.error(`CalDAV: could not expand event ${uid}`, err);
      }
    }
  }

  return out;
}

// ── Shared fetch (GET /api/integrations/calendar and /api/aknclient/calendar) ──
export async function fetchCalendarPayload(opts: { days?: number; limit?: number } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const days  = opts.days  ?? 7;
  const limit = opts.limit ?? 10;
  const { url, user, pass } = cfg();
  if (!url || !user || !pass) {
    return { status: 200, body: { events: [], status: "unconfigured" } };
  }

  try {
    const cals = await discoverCalendars();
    const excluded = excludedCalendars();
    const wanted = cals.filter((c) => !isExcludedCalendar(c.name, excluded));

    // If discovery found no collections at all, try a direct REPORT on the base URL
    const targets: CalendarCollection[] = cals.length > 0 ? wanted : [{ path: new URL(url).pathname, name: "" }];

    // Every collection excluded: nothing to show, but not an error
    if (targets.length === 0) {
      return { status: 200, body: { events: [], status: "ok", fetchedAt: new Date().toISOString() } };
    }

    const results = await Promise.all(targets.map((c) => fetchCalendarEvents(c.path, days)));

    // Every collection erroring is a failure, not an empty week
    if (!results.some((r) => r.ok)) {
      return { status: 502, body: { events: [], status: "error" } };
    }

    const now      = Date.now();
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const win: Win = { fromMs: now, toMs: now + days * DAY_MS, now, dayStartMs: midnight.getTime() };

    const events = results
      .flatMap((r, i) => expandIcsBlocks(r.blocks, targets[i].name, win))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, limit);

    return { status: 200, body: { events, status: "ok", fetchedAt: new Date().toISOString() } };
  } catch (err) {
    console.error("CalDAV error:", err);
    return { status: 502, body: { events: [], status: "error" } };
  }
}
