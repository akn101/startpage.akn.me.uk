const cfg = () => ({
  url:  process.env.CALDAV_URL ?? "",
  user: process.env.CALDAV_USERNAME ?? "",
  pass: process.env.CALDAV_PASSWORD ?? "",
});

function basicAuth() {
  return "Basic " + Buffer.from(`${cfg().user}:${cfg().pass}`).toString("base64");
}

// ── Discover calendar collections via PROPFIND ─────────────────────────────
async function discoverCalendars(): Promise<string[]> {
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

  // Extract hrefs of calendar collections
  const hrefs: string[] = [];
  const hrefRe = /<[^:>]*:?href[^>]*>([^<]+)<\/[^>]+href>/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(xml)) !== null) {
    const href = m[1].trim();
    // Only include resources that have calendar resourcetype
    if (xml.includes("<cal:calendar") || xml.includes(":calendar/>") || xml.includes(":calendar />")) {
      if (href !== new URL(cfg().url).pathname && href.endsWith("/")) {
        hrefs.push(href);
      }
    }
  }

  // Fallback: include all sub-paths that look like calendar collections
  if (hrefs.length === 0) {
    const allHrefRe = /<[^>]*:?href[^>]*>([^<]+)<\/[^>]*:?href>/gi;
    while ((m = allHrefRe.exec(xml)) !== null) {
      const href = m[1].trim();
      const base = new URL(cfg().url).pathname;
      if (href !== base && href.startsWith(base) && href.endsWith("/")) {
        hrefs.push(href);
      }
    }
  }

  return hrefs;
}

// ── Fetch events from a single calendar via REPORT ─────────────────────────
async function fetchCalendarEvents(calPath: string, days: number): Promise<{ ok: boolean; blocks: string[] }> {
  // Start at midnight, not "now" — otherwise today's all-day events (which are
  // stamped 00:00) fall outside the window as soon as the day starts.
  const now       = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const weekAhead = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
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

  // Extract calendar-data CDATA sections
  const icsBlocks: string[] = [];
  const re = /<[^>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^>]*:?calendar-data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    icsBlocks.push(m[1].trim());
  }
  return { ok: true, blocks: icsBlocks };
}

// ── iCal parser ────────────────────────────────────────────────────────────
interface CalEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  joinUrl?: string;
}

function parseIcalDate(val: string): { iso: string; allDay: boolean } {
  // Strip TZID= param if present
  const v = val.includes(":") ? val.split(":").pop()! : val;
  const allDay = v.length === 8;
  if (allDay) {
    return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00.000Z`, allDay: true };
  }
  const s = v.replace("Z", "");
  try {
    const iso = new Date(
      `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`
    ).toISOString();
    return { iso, allDay: false };
  } catch {
    return { iso: new Date().toISOString(), allDay: false };
  }
}

function parseIcsBlock(ics: string): CalEvent | null {
  // Unfold lines
  const text  = ics.replace(/\r\n[ \t]/g, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  let inEvent = false;
  const ev: Partial<CalEvent> = {};

  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") { inEvent = true; continue; }
    if (raw === "END:VEVENT")   { inEvent = false; break; }
    if (!inEvent) continue;

    const colon = raw.indexOf(":");
    if (colon === -1) continue;
    const key = raw.slice(0, colon).toUpperCase();
    const val = raw.slice(colon + 1);

    if (key === "UID")           ev.uid      = val;
    if (key === "SUMMARY")       ev.summary  = val.replace(/\\,/g, ",").replace(/\\n/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (key === "LOCATION")      ev.location = val.replace(/\\,/g, ",");
    if (key === "URL")           ev.joinUrl  = val.trim();
    if (key === "X-GOOGLE-CONFERENCE") ev.joinUrl = val.trim();
    if (key === "DESCRIPTION" && !ev.joinUrl) {
      const match = val.match(/https?:\/\/(?:[^\s\\]+\.)?(?:teams\.microsoft\.com|meet\.google\.com|zoom\.us|whereby\.com|webex\.com)[^\s\\]*/i);
      if (match) ev.joinUrl = match[0].replace(/\\n.*/, "").trim();
    }
    if (key.startsWith("DTSTART")) {
      const parsed  = parseIcalDate(val);
      ev.start      = parsed.iso;
      ev.allDay     = parsed.allDay;
    }
    if (key.startsWith("DTEND"))  {
      ev.end = parseIcalDate(val).iso;
    }
  }

  if (!ev.uid || !ev.summary || !ev.start) return null;
  return ev as CalEvent;
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
    const calPaths = await discoverCalendars();

    // If discovery returned nothing, try a direct REPORT on the base URL
    const paths = calPaths.length > 0 ? calPaths : [new URL(url).pathname];

    const results = await Promise.all(paths.map((p) => fetchCalendarEvents(p, days)));

    // Every collection erroring is a failure, not an empty week
    if (!results.some((r) => r.ok)) {
      return { status: 502, body: { events: [], status: "error" } };
    }

    const icsBlocks = results.flatMap((r) => r.blocks);

    const now       = Date.now();
    const weekAhead = now + days * 24 * 60 * 60 * 1000;
    const midnight  = new Date();
    midnight.setUTCHours(0, 0, 0, 0);

    const events = icsBlocks
      .map(parseIcsBlock)
      .filter((e): e is CalEvent => {
        if (!e) return false;
        const t = new Date(e.start).getTime();
        // All-day events sit at 00:00 — keep them for the whole of their day
        const cutoff = e.allDay ? midnight.getTime() : now - 60_000;
        return t >= cutoff && t <= weekAhead;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, limit);

    return { status: 200, body: { events, status: "ok", fetchedAt: new Date().toISOString() } };
  } catch (err) {
    console.error("CalDAV error:", err);
    return { status: 502, body: { events: [], status: "error" } };
  }
}
