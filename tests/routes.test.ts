import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { KEY, OWNER, fake, env, authed, json, mockDb } from "./helpers";

mockDb();
const load = async (p: string) => import(p);

beforeEach(() => { env(); fake.tables = {}; fake.failNext = null; });
afterEach(() => { vi.unstubAllGlobals(); });

const noKey = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://t${path}`, { method, body: body ? JSON.stringify(body) : undefined });
const wrongKey = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://t${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: "Bearer wrong" } });

const block = (id: string, started: string, extra = {}) => ({
  id, label: "TEST aknclient block", project: null, started_at: started, ended_at: started, duration_s: 60, ...extra,
});

describe("worklog", () => {
  const url = "/api/aknclient/worklog";
  it("401 without key, 401 wrong key, 503 without env", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    expect((await POST(noKey(url, "POST", { blocks: [] }))).status).toBe(401);
    expect((await POST(wrongKey(url, "POST", { blocks: [] }))).status).toBe(401);
    delete process.env.AKNCLIENT_API_KEY;
    expect((await POST(json(url, "POST", { blocks: [] }))).status).toBe(503);
  });
  it("400 on bad body", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    expect((await POST(json(url, "POST", { blocks: [{ id: "a" }] }))).status).toBe(400);
    expect((await POST(json(url, "POST", { blocks: [], range: { from: "2026-01-02", to: "2026-01-01" } }))).status).toBe(400);
  });
  it("happy path stores private owner rows", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    const res = await POST(json(url, "POST", { blocks: [block("a", "2026-11-02T09:00:00Z", { project: "Slate" })] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 1, deleted: 0 });
    expect(fake.rows("time_sessions")[0]).toMatchObject({
      source: "aknclient", external_id: "a", is_public: false, user_id: OWNER, project: "Slate", duration_s: 60,
    });
  });
  it("is idempotent: same payload twice leaves one row; changed payload updates it", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    const b = block("a", "2026-11-02T09:00:00Z");
    await POST(json(url, "POST", { blocks: [b] }));
    await POST(json(url, "POST", { blocks: [b] }));
    expect(fake.rows("time_sessions")).toHaveLength(1);
    await POST(json(url, "POST", { blocks: [{ ...b, label: "renamed", duration_s: 120 }] }));
    expect(fake.rows("time_sessions")).toHaveLength(1);
    expect(fake.rows("time_sessions")[0]).toMatchObject({ label: "renamed", duration_s: 120 });
  });
  it("range delete removes only stale aknclient rows inside [from,to)", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    fake.seed("time_sessions", [
      { id: "m", source: null, external_id: null, user_id: OWNER, started_at: "2026-11-02T09:30:00Z", label: "manual timer" },
      { id: "o", source: "other", external_id: "stale", user_id: OWNER, started_at: "2026-11-02T09:30:00Z", label: "other source" },
      { id: "s1", source: "aknclient", external_id: "stale", user_id: OWNER, started_at: "2026-11-02T09:30:00Z", label: "stale" },
      { id: "s2", source: "aknclient", external_id: "keep", user_id: OWNER, started_at: "2026-11-02T09:40:00Z", label: "keep" },
      { id: "s3", source: "aknclient", external_id: "before", user_id: OWNER, started_at: "2026-11-02T08:59:59Z", label: "before range" },
      { id: "s4", source: "aknclient", external_id: "at-end", user_id: OWNER, started_at: "2026-11-02T10:00:00Z", label: "exactly at to (excluded)" },
      { id: "s5", source: "aknclient", external_id: "stale", user_id: "someone-else", started_at: "2026-11-02T09:30:00Z", label: "other user" },
    ]);
    const res = await POST(json(url, "POST", {
      blocks: [block("keep", "2026-11-02T09:40:00Z"), block("new", "2026-11-02T09:50:00Z")],
      range: { from: "2026-11-02T09:00:00Z", to: "2026-11-02T10:00:00Z" },
    }));
    expect(await res.json()).toEqual({ upserted: 2, deleted: 1 });
    const left = fake.rows("time_sessions").map((r) => r.id);
    expect(left).toEqual(expect.arrayContaining(["m", "o", "s2", "s3", "s4", "s5"]));
    expect(left).not.toContain("s1");
  });
  it("empty blocks + range clears that window of aknclient rows only", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    fake.seed("time_sessions", [
      { id: "m", source: null, external_id: null, user_id: OWNER, started_at: "2026-11-02T09:30:00Z" },
      { id: "s1", source: "aknclient", external_id: "x", user_id: OWNER, started_at: "2026-11-02T09:30:00Z" },
    ]);
    const res = await POST(json(url, "POST", { blocks: [], range: { from: "2026-11-02T09:00:00Z", to: "2026-11-02T10:00:00Z" } }));
    expect(await res.json()).toEqual({ upserted: 0, deleted: 1 });
    expect(fake.rows("time_sessions").map((r) => r.id)).toEqual(["m"]);
  });
  it("ids containing quotes/commas are handled in the not-in list", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    const weird = 'a,"b"),c';
    fake.seed("time_sessions", [{ id: "s1", source: "aknclient", external_id: weird, user_id: OWNER, started_at: "2026-11-02T09:30:00Z" }]);
    const res = await POST(json(url, "POST", {
      blocks: [block(weird, "2026-11-02T09:30:00Z")], range: { from: "2026-11-02T09:00:00Z", to: "2026-11-02T10:00:00Z" },
    }));
    expect((await res.json()).deleted).toBe(0);
  });
  it("500 when the database errors", async () => {
    const { POST } = await load("@/app/api/aknclient/worklog/route");
    fake.failNext = "boom";
    expect((await POST(json(url, "POST", { blocks: [block("a", "2026-11-02T09:00:00Z")] }))).status).toBe(500);
  });
});

describe("todos", () => {
  const url = "/api/aknclient/todos";
  beforeEach(() => fake.seed("todos", [
    { id: "t1", text: "public", done: false, is_public: true, user_id: OWNER },
    { id: "t2", text: "private", done: false, is_public: false, user_id: OWNER },
    { id: "t3", text: "not mine", done: false, is_public: false, user_id: "other" },
  ]));
  it("401 without / wrong key", async () => {
    const { GET, PATCH } = await load("@/app/api/aknclient/todos/route");
    expect((await GET(noKey(url))).status).toBe(401);
    expect((await GET(wrongKey(url))).status).toBe(401);
    expect((await PATCH(noKey(url, "PATCH", { id: "t1", done: true }))).status).toBe(401);
    expect((await PATCH(wrongKey(url, "PATCH", { id: "t1", done: true }))).status).toBe(401);
  });
  it("GET returns all owner todos incl. private", async () => {
    const { GET } = await load("@/app/api/aknclient/todos/route");
    const res = await GET(authed(url));
    expect(res.status).toBe(200);
    const { todos } = await res.json();
    expect(todos.map((t: any) => t.id)).toEqual(["t1", "t2"]);
  });
  it("PATCH updates and returns the todo; 404 for someone else's; 400 for bad body", async () => {
    const { PATCH } = await load("@/app/api/aknclient/todos/route");
    const res = await PATCH(json(url, "PATCH", { id: "t2", done: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "t2", done: true, is_public: false });
    expect((await PATCH(json(url, "PATCH", { id: "t3", done: true }))).status).toBe(404);
    expect(fake.rows("todos").find((t) => t.id === "t3")!.done).toBe(false);
    expect((await PATCH(json(url, "PATCH", { id: "t2" }))).status).toBe(400);
  });
});

describe("tasks", () => {
  const url = "/api/aknclient/tasks";
  it("401 without / wrong key", async () => {
    const { GET } = await load("@/app/api/aknclient/tasks/route");
    expect((await GET(noKey(url))).status).toBe(401);
    expect((await GET(wrongKey(url))).status).toBe(401);
  });
  it("happy path: same shape as /api/tasks, private rows included", async () => {
    process.env.NOTION_TOKEN = "t"; process.env.NOTION_DATABASE_ID_PROJECTS = "p"; process.env.NOTION_DATABASE_ID_TASKS = "k";
    const page = (name: string, pub: boolean, titleKey: string) => ({
      id: name, url: `https://notion.so/${name}`,
      properties: {
        [titleKey]: { title: [{ plain_text: name }] }, Status: { select: { name: "Active" } },
        Priority: { select: { name: "High" } }, Project: { rich_text: [] }, Deadline: { date: null },
        is_public: { checkbox: pub }, Color: { select: null }, Category: { select: null }, Keywords: { rich_text: [] },
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (u: string) => ({
      json: async () => u.includes("/databases/p/")
        ? { results: [page("proj-private", false, "Name")] }
        : { results: [page("task-private", false, "Title")] },
    })));
    const { GET } = await load("@/app/api/aknclient/tasks/route");
    const res = await GET(authed(url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["projects", "tasks"]);
    expect(body.tasks[0]).toMatchObject({ id: "task-private", title: "task-private", priority: "High", is_public: false });
    expect(body.projects[0]).toMatchObject({ name: "proj-private" });
  });
});

describe("calendar", () => {
  const url = "/api/aknclient/calendar?days=7";
  it("401 without / wrong key", async () => {
    const { GET } = await load("@/app/api/aknclient/calendar/route");
    expect((await GET(noKey(url))).status).toBe(401);
    expect((await GET(wrongKey(url))).status).toBe(401);
  });
  it("happy path returns events/status shape; unconfigured is the same shape", async () => {
    const { GET } = await load("@/app/api/aknclient/calendar/route");
    const unconf = await GET(authed(url));
    expect(await unconf.json()).toEqual({ events: [], status: "unconfigured" });

    process.env.CALDAV_URL = "https://dav.example.test/cal/"; process.env.CALDAV_USERNAME = "u"; process.env.CALDAV_PASSWORD = "p";
    const start = new Date(Date.now() + 3600_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Test event\r\nDTSTART:${start}\r\nDTEND:${start}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => ({
      ok: true,
      text: async () => init.method === "PROPFIND"
        ? `<d:multistatus><d:response><d:href>/cal/</d:href></d:response></d:multistatus>`
        : `<d:multistatus><c:calendar-data>${ics}</c:calendar-data></d:multistatus>`,
    })));
    const res = await GET(authed(url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.events[0]).toMatchObject({ uid: "e1", summary: "Test event", allDay: false });
    delete process.env.CALDAV_URL; delete process.env.CALDAV_USERNAME; delete process.env.CALDAV_PASSWORD;
  });
});

describe("notify", () => {
  const url = "/api/aknclient/notify";
  it("401 without / wrong key", async () => {
    const { POST } = await load("@/app/api/aknclient/notify/route");
    expect((await POST(noKey(url, "POST", { title: "a", body: "b" }))).status).toBe(401);
    expect((await POST(wrongKey(url, "POST", { title: "a", body: "b" }))).status).toBe(401);
    expect(fake.rows("notifications")).toHaveLength(0);
  });
  it("happy path stores with source aknclient; 400 when fields missing", async () => {
    const { POST } = await load("@/app/api/aknclient/notify/route");
    const res = await POST(json(url, "POST", { title: "hi", body: "there" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(fake.rows("notifications")[0]).toMatchObject({ title: "hi", body: "there", source: "aknclient" });
    expect((await POST(json(url, "POST", { title: "hi" }))).status).toBe(400);
  });
  it("legacy /api/notify still works and maps unknown sources to other", async () => {
    process.env.NOTIFY_API_KEY = "nk";
    const { POST } = await load("@/app/api/notify/route");
    const req = new Request("http://t/api/notify", { method: "POST", headers: { "x-api-key": "nk" }, body: JSON.stringify({ title: "a", body: "b", source: "weird" }) });
    expect((await POST(req as any)).status).toBe(200);
    expect(fake.rows("notifications")[0].source).toBe("other");
  });
});
