import { afterEach, describe, expect, it, vi } from "vitest";
import { expandIcsBlocks, fetchCalendarPayload, isExcludedCalendar, parseCalendarCollections } from "@/lib/caldav";

const wrap = (body: string, extra = "") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${extra}${body}END:VCALENDAR\r\n`;

const win = (now: string, days = 14) => {
  const n = Date.parse(now);
  const d = new Date(n); d.setUTCHours(0, 0, 0, 0);
  return { fromMs: n, toMs: n + days * 86400000, now: n, dayStartMs: d.getTime() };
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("TZID handling", () => {
  it("converts Europe/London summer time to UTC", () => {
    const ics = wrap("BEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Standup\r\nDTSTART;TZID=Europe/London:20260715T100000\r\nDTEND;TZID=Europe/London:20260715T103000\r\nEND:VEVENT\r\n");
    const [e] = expandIcsBlocks([ics], "Work", win("2026-07-14T00:00:00Z"));
    expect(e.start).toBe("2026-07-15T09:00:00.000Z");
    expect(e.end).toBe("2026-07-15T09:30:00.000Z");
    expect(e.calendar).toBe("Work");
    expect(e.allDay).toBe(false);
  });
  it("converts America/New_York winter time and leaves Z times alone", () => {
    const ics = wrap(
      "BEGIN:VEVENT\r\nUID:a2\r\nSUMMARY:NY\r\nDTSTART;TZID=America/New_York:20261215T090000\r\nDTEND;TZID=America/New_York:20261215T100000\r\nEND:VEVENT\r\n" +
      "BEGIN:VEVENT\r\nUID:a3\r\nSUMMARY:Zulu\r\nDTSTART:20261215T090000Z\r\nDTEND:20261215T100000Z\r\nEND:VEVENT\r\n");
    const evs = expandIcsBlocks([ics], "c", win("2026-12-14T00:00:00Z"));
    expect(evs.find((e) => e.uid === "a2")!.start).toBe("2026-12-15T14:00:00.000Z");
    expect(evs.find((e) => e.uid === "a3")!.start).toBe("2026-12-15T09:00:00.000Z");
  });
  it("floating time uses STARTPAGE_CALENDAR_TZ", () => {
    vi.stubEnv("STARTPAGE_CALENDAR_TZ", "Asia/Hong_Kong");
    const ics = wrap("BEGIN:VEVENT\r\nUID:f1\r\nSUMMARY:Float\r\nDTSTART:20260715T100000\r\nDTEND:20260715T110000\r\nEND:VEVENT\r\n");
    const [e] = expandIcsBlocks([ics], "c", win("2026-07-14T00:00:00Z"));
    expect(e.start).toBe("2026-07-15T02:00:00.000Z");
  });
});

describe("recurrence", () => {
  const weekly =
    "BEGIN:VEVENT\r\nUID:w1\r\nSUMMARY:Weekly sync\r\nDTSTART;TZID=Europe/London:20260601T100000\r\nDTEND;TZID=Europe/London:20260601T110000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEXDATE;TZID=Europe/London:20261109T100000\r\nEND:VEVENT\r\n";
  it("expands weekly RRULE inside window and honours EXDATE, with unique uids", () => {
    // window 2026-11-02 .. 2026-11-23 covers Mondays 2, 9 (excluded), 16, 23(10:00 > end?) 
    const evs = expandIcsBlocks([wrap(weekly)], "c", win("2026-11-02T00:00:00Z", 21));
    const starts = evs.map((e) => e.start);
    expect(starts).toEqual(["2026-11-02T10:00:00.000Z", "2026-11-16T10:00:00.000Z"]);
    expect(new Set(evs.map((e) => e.uid)).size).toBe(evs.length);
    expect(evs[0].end).toBe("2026-11-02T11:00:00.000Z");
  });
  it("keeps wall time across DST (BST -> GMT)", () => {
    const evs = expandIcsBlocks([wrap(weekly)], "c", win("2026-10-20T00:00:00Z", 10));
    expect(evs.map((e) => e.start)).toEqual(["2026-10-26T10:00:00.000Z"]);
    const before = expandIcsBlocks([wrap(weekly)], "c", win("2026-10-19T00:00:00Z", 1));
    expect(before.map((e) => e.start)).toEqual(["2026-10-19T09:00:00.000Z"]);
  });
  it("applies RECURRENCE-ID overrides", () => {
    const override =
      "BEGIN:VEVENT\r\nUID:w1\r\nSUMMARY:Weekly sync (moved)\r\nRECURRENCE-ID;TZID=Europe/London:20261116T100000\r\nDTSTART;TZID=Europe/London:20261117T150000\r\nDTEND;TZID=Europe/London:20261117T160000\r\nEND:VEVENT\r\n";
    const evs = expandIcsBlocks([wrap(weekly + override)], "c", win("2026-11-02T00:00:00Z", 21));
    expect(evs.map((e) => e.start)).toEqual(["2026-11-02T10:00:00.000Z", "2026-11-17T15:00:00.000Z"]);
    expect(evs[1].summary).toBe("Weekly sync (moved)");
  });
});

describe("all-day and ongoing", () => {
  it("keeps today's all-day event and marks allDay", () => {
    const ics = wrap("BEGIN:VEVENT\r\nUID:d1\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261118\r\nDTEND;VALUE=DATE:20261119\r\nEND:VEVENT\r\n");
    const [e] = expandIcsBlocks([ics], "c", win("2026-11-18T15:00:00Z"));
    expect(e).toMatchObject({ allDay: true, start: "2026-11-18T00:00:00.000Z", end: "2026-11-19T00:00:00.000Z" });
  });
  it("drops yesterday's all-day event", () => {
    const ics = wrap("BEGIN:VEVENT\r\nUID:d2\r\nSUMMARY:Old\r\nDTSTART;VALUE=DATE:20261117\r\nDTEND;VALUE=DATE:20261118\r\nEND:VEVENT\r\n");
    expect(expandIcsBlocks([ics], "c", win("2026-11-18T15:00:00Z"))).toHaveLength(0);
  });
  it("shows ongoing timed events but not ended ones", () => {
    const ics = wrap(
      "BEGIN:VEVENT\r\nUID:o1\r\nSUMMARY:Ongoing\r\nDTSTART:20261118T090000Z\r\nDTEND:20261118T170000Z\r\nEND:VEVENT\r\n" +
      "BEGIN:VEVENT\r\nUID:o2\r\nSUMMARY:Ended\r\nDTSTART:20261118T080000Z\r\nDTEND:20261118T090000Z\r\nEND:VEVENT\r\n");
    const evs = expandIcsBlocks([ics], "c", win("2026-11-18T12:00:00Z"));
    expect(evs.map((e) => e.uid)).toEqual(["o1"]);
  });
});

describe("calendar discovery and exclusion", () => {
  const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:displayname></d:displayname></d:prop></d:propstat></d:response>
<d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname></d:prop></d:propstat></d:response>
<d:response><d:href>/123/calendars/inbox/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype><d:displayname>Inbox</d:displayname></d:prop></d:propstat></d:response>
<d:response><d:href>/123/calendars/outbox/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:schedule-outbox/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/123/calendars/w/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>worklog</d:displayname></d:prop></d:propstat></d:response>
<d:response><d:href>/123/calendars/l/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Location Tracking</d:displayname></d:prop></d:propstat></d:response>
</d:multistatus>`;

  it("parses only real calendar collections, per response", () => {
    const cols = parseCalendarCollections(xml, "/123/calendars/");
    expect(cols.map((c) => c.name)).toEqual(["Home", "worklog", "Location Tracking"]);
  });
  it("matches exclude list case-insensitively, env override", () => {
    expect(isExcludedCalendar("WorkLog")).toBe(true);
    expect(isExcludedCalendar("Home")).toBe(false);
    vi.stubEnv("STARTPAGE_CALENDAR_EXCLUDE", "home, Foo");
    expect(isExcludedCalendar("Home")).toBe(true);
    expect(isExcludedCalendar("worklog")).toBe(false);
  });
  it("fetchCalendarPayload skips excluded calendars and tags events with calendar name", async () => {
    vi.stubEnv("CALDAV_URL", "https://caldav.example.com/123/calendars/");
    vi.stubEnv("CALDAV_USERNAME", "u");
    vi.stubEnv("CALDAV_PASSWORD", "p");
    const future = new Date(Date.now() + 3600_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const mk = (uid: string, s: string) => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data>${wrap(`BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${s}\r\nDTSTART:${future}\r\nEND:VEVENT\r\n`)}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`;
    const reported: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init: { method: string }) => {
      if (init.method === "PROPFIND") return new Response(xml, { status: 207 });
      reported.push(u);
      return new Response(u.includes("/home/") ? mk("h", "Dentist") : mk("x", "Sites · Microsoft Edge"), { status: 207 });
    }));
    const { status, body } = await fetchCalendarPayload();
    expect(status).toBe(200);
    expect(reported).toEqual(["https://caldav.example.com/123/calendars/home/"]);
    const events = body.events as { summary: string; calendar: string }[];
    expect(events.map((e) => [e.summary, e.calendar])).toEqual([["Dentist", "Home"]]);
  });
});
