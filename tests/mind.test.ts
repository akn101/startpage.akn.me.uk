import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fake, mockDb } from "./helpers";
import { parseWhen } from "@/lib/when";
import { mapReminders, mapTasks, nextDate } from "@/lib/bonds";

mockDb();
const jar = new Map<string, string>();
vi.doMock("next/headers", () => ({ cookies: () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined) }) }));

// Wed 12 Nov 2026, 10:00 London (GMT)
const NOW = new Date("2026-11-12T10:00:00Z");
const iso = (d: Date | null) => d?.toISOString();

describe("parseWhen", () => {
  it.each([
    ["journal tomorrow", "journal", "2026-11-13T09:00:00.000Z"],
    ["remind me to journal tomorrow", "journal", "2026-11-13T09:00:00.000Z"],
    ["call mum tonight", "call mum", "2026-11-12T20:00:00.000Z"],
    ["gym friday 6pm", "gym", "2026-11-13T18:00:00.000Z"],
    ["stretch in 2 hours", "stretch", "2026-11-12T12:00:00.000Z"],
    ["pay rent 2026-12-01", "pay rent", "2026-12-01T09:00:00.000Z"],
    ["tea at 9am", "tea", "2026-11-13T09:00:00.000Z"], // 9am already passed today
    ["review wednesday", "review", "2026-11-18T09:00:00.000Z"], // never today
  ])("%s", (input, text, due) => {
    const p = parseWhen(input, NOW);
    expect(p.text).toBe(text);
    expect(iso(p.due)).toBe(due);
  });

  it("leaves text with no date alone", () => {
    expect(parseWhen("be more relaxed", NOW)).toEqual({ text: "be more relaxed", due: null });
  });

  it("uses BST in summer", () => {
    expect(iso(parseWhen("swim tomorrow", new Date("2026-07-01T10:00:00Z")).due)).toBe("2026-07-02T08:00:00.000Z");
  });
});

describe("bonds mapping", () => {
  it("drops completed tasks and sorts by due date", () => {
    const t = mapTasks([
      { id: 1, label: "b", completed: false, due_at: "2026-12-01", contacts: [{ first_name: "Sakiya", last_name: "Sultana" }] },
      { id: 2, label: "done", completed: true, due_at: null },
      { id: 3, label: "a", completed: false, due_at: "2026-11-20" },
    ]);
    expect(t.map((x) => x.id)).toEqual([3, 1]);
    expect(t[1].people).toEqual(["Sakiya Sultana"]);
  });

  it("finds the next yearly date and keeps only the next 30 days", () => {
    expect(nextDate({ day: 1, month: 1, year: null, type: "recurring" }, NOW)).toBe("2027-01-01");
    expect(nextDate({ day: 20, month: 11, year: 1990, type: "recurring" }, NOW)).toBe("2026-11-20");
    const r = mapReminders([
      { id: 1, label: "Birthday", contact_id: "c", contact_first_name: "Lyra", day: 20, month: 11, year: null, type: "recurring" },
      { id: 2, label: "Far", contact_id: "c", day: 1, month: 3, year: null, type: "recurring" },
    ], NOW);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ person: "Lyra", next: "2026-11-20" });
  });
});

describe("/api/mind", () => {
  let lock: typeof import("@/lib/lock");
  let session: typeof import("@/lib/session");
  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-session-secret-not-real-0123456789";
    process.env.STARTPAGE_OWNER_UID = "owner-uid";
    delete process.env.BONDS_API_URL; delete process.env.BONDS_API_TOKEN;
    fake.tables = {}; jar.clear();
    lock = await import("@/lib/lock");
    session = await import("@/lib/session");
  });
  afterEach(() => vi.unstubAllGlobals());

  const signIn = async () => {
    const t = await session.signSession({ uid: "owner-uid", role: "admin", projects: ["*"] } as any);
    jar.set(session.SESSION_COOKIE, t);
    return (await session.verifySession(t))!;
  };
  const req = (method: string, body?: unknown) =>
    new Request("http://t/api/mind", { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });

  it("401 signed out, 423 without the sensitive PIN", async () => {
    const m = await import("@/app/api/mind/route");
    expect((await m.GET()).status).toBe(401);
    const s = await signIn();
    const r = await m.GET();
    expect(r.status).toBe(423);
    expect(await r.json()).toEqual({ error: "pin_required", scope: "sensitive" });
    jar.set("sp_unlock", await lock.signUnlock(s as any, "private")); // private unlock is not enough
    expect((await m.POST(req("POST", { kind: "thought", text: "x" }))).status).toBe(423);
  });

  it("adds a reminder with a parsed date, lists, completes", async () => {
    const m = await import("@/app/api/mind/route");
    const s = await signIn();
    jar.set("sp_unlock_s", await lock.signUnlock(s as any, "sensitive"));
    const r = await m.POST(req("POST", { kind: "reminder", text: "journal tomorrow" }));
    expect(r.status).toBe(200);
    const { item } = await r.json();
    expect(item.text).toBe("journal");
    expect(item.due_at).toMatch(/T0[89]:00:00/);
    await m.POST(req("POST", { kind: "wish", text: "stand on my own legs", person: "Sakiya Sultana" }));
    const list = await (await m.GET()).json();
    expect(list.items).toHaveLength(2);
    expect(list.bonds).toBeNull();
    expect(fake.rows("mind_items").every((x) => x.user_id === "owner-uid")).toBe(true);
    await m.PATCH(req("PATCH", { id: item.id, done: true }));
    expect((await (await m.GET()).json()).items).toHaveLength(1);
    expect((await m.POST(req("POST", { kind: "nope", text: "x" }))).status).toBe(400);
  });

  it("pulls Bonds without leaking the token", async () => {
    process.env.BONDS_API_URL = "https://bonds.test/api/vaults/v";
    process.env.BONDS_API_TOKEN = "tok-not-real";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (u: string, init: RequestInit) => {
      seen.push(String((init.headers as Record<string, string>).Authorization));
      const data = u.endsWith("/tasks") ? [{ id: 1, label: "Call SS", completed: false, due_at: null }] : [];
      return new Response(JSON.stringify({ success: true, data }));
    });
    const m = await import("@/app/api/mind/route");
    const s = await signIn();
    jar.set("sp_unlock_s", await lock.signUnlock(s as any, "sensitive"));
    const body = await (await m.GET()).text();
    expect(seen).toEqual(["Bearer tok-not-real", "Bearer tok-not-real"]);
    expect(body).toContain("Call SS");
    expect(body).not.toContain("tok-not-real");
  });
});

describe("brief", () => {
  it("plain brief lists what is there and never invents", async () => {
    const { plainBrief } = await import("@/lib/brief");
    const t = plainBrief({
      now: "2026-11-12T08:00:00Z", events: [{ title: "Dentist", start: "2026-11-12T10:00:00Z" }],
      todos: ["ship tv mode"], reminders: [{ text: "journal", due_at: null }],
      wishes: [{ person: "Lyra", text: "be more relaxed" }], thoughts: [], bonds: null,
    });
    expect(t).toContain("Dentist"); expect(t).toContain("journal"); expect(t).toContain("Lyra wants you to be more relaxed");
    expect(plainBrief({ now: "", events: [], todos: [], reminders: [], wishes: [], thoughts: [], bonds: null })).toMatch(/Nothing on today/);
  });
});
