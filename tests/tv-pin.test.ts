import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { fake, mockDb } from "./helpers";

mockDb();
const jar = new Map<string, string>();
const hdrs = new Map<string, string>();
vi.doMock("next/headers", () => ({
  cookies: () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined) }),
  headers: () => ({ get: (n: string) => hdrs.get(n.toLowerCase()) ?? null }),
}));

const PIN = "482915";
const TV_UA = "Mozilla/5.0 StartpageTV/3";
let lock: typeof import("@/lib/lock");
let session: typeof import("@/lib/session");

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-session-secret-not-real-0123456789";
  process.env.STARTPAGE_OWNER_UID = "owner-uid";
  delete process.env.STARTPAGE_TV_DEVICES;
  delete process.env.STARTPAGE_TV_MODULES;
  fake.tables = {}; fake.failNext = null; jar.clear(); hdrs.clear();
  lock = await import("@/lib/lock");
  session = await import("@/lib/session");
  process.env.STARTPAGE_PIN_HASH = await lock.hashPin(PIN, 1000);
});

const signIn = async (device?: "tv") => {
  const token = await session.signSession({ uid: "owner-uid", email: null, displayName: "Owner", role: "admin", projects: ["*"], ...(device ? { device } : {}) });
  jar.set(session.SESSION_COOKIE, token);
  return (await session.verifySession(token))!;
};
const unlock = async (s: any, ...scopes: ("private" | "sensitive")[]) => {
  for (const sc of scopes) jar.set(lock.UNLOCK_COOKIE[sc], await lock.signUnlock(s, sc));
};

describe("PIN is TV-only", () => {
  it("browser: no PIN prompts on sensitive routes, lock/state says no PIN", async () => {
    await signIn();
    const { requireSensitive } = await import("@/lib/auth");
    expect(await requireSensitive()).toEqual({ uid: "owner-uid" });
    const { GET } = await import("@/app/api/lock/state/route");
    const st = await (await GET()).json();
    expect(st.pinConfigured).toBe(false);
    expect(st.unlocked).toEqual({ private: true, sensitive: true });
  });

  it("TV: sensitive needs the PIN; lock/state reports it", async () => {
    hdrs.set("user-agent", TV_UA);
    const s = await signIn("tv");
    await unlock(s, "private");
    const { requireSensitive } = await import("@/lib/auth");
    const g = await requireSensitive();
    expect(g).toBeInstanceOf(Response);
    expect((g as Response).status).toBe(423);
    const { GET } = await import("@/app/api/lock/state/route");
    expect(await (await GET()).json()).toMatchObject({ pinConfigured: true, device: "tv", unlocked: { private: true, sensitive: false } });
    await unlock(s, "sensitive");
    expect(await requireSensitive()).toEqual({ uid: "owner-uid" });
  });

  it("signed-out lock/state: pinConfigured true only for the TV UA", async () => {
    const { GET } = await import("@/app/api/lock/state/route");
    expect((await (await GET()).json()).pinConfigured).toBe(false);
    hdrs.set("user-agent", TV_UA);
    expect((await (await GET()).json()).pinConfigured).toBe(true);
  });
});

describe("GET /api/tv/config", () => {
  it("guest for anyone, owner once the TV is PIN-unlocked", async () => {
    const { GET } = await import("@/app/api/tv/config/route");
    hdrs.set("user-agent", TV_UA);
    expect(await (await GET()).json()).toEqual({ profile: "guest", modules: ["clock", "weather"], pinConfigured: true, location: null });
    const s = await signIn("tv");
    expect((await (await GET()).json()).profile).toBe("guest");
    await unlock(s, "private");
    const owner = await (await GET()).json();
    expect(owner.profile).toBe("owner");
    expect(owner.modules).toContain("money");
    expect(owner.displayName).toBe("Owner");
  });

  it("module lists are overridable by env", async () => {
    process.env.STARTPAGE_TV_MODULES = JSON.stringify({ guest: ["clock"] });
    const { GET } = await import("@/app/api/tv/config/route");
    expect((await (await GET()).json()).modules).toEqual(["clock"]);
  });

  it("middleware lets a locked TV reach it", async () => {
    await signIn("tv");
    const { middleware } = await import("@/middleware");
    const cookie = `sp_session=${jar.get(session.SESSION_COOKIE)}`;
    expect((await middleware(new NextRequest("http://t/api/tv/config", { headers: { cookie } }))).status).toBe(200);
    expect((await middleware(new NextRequest("http://t/api/money", { headers: { cookie } }))).status).toBe(423);
  });
});

describe("TV device allowlist on unlock", () => {
  const req = (device?: string) =>
    new NextRequest("http://t/api/lock/unlock", {
      method: "POST",
      body: JSON.stringify({ pin: PIN, scope: "sensitive" }),
      headers: { "content-type": "application/json", "user-agent": TV_UA, ...(device ? { "x-startpage-device": device } : {}) },
    });
  it("any TV may unlock when unset; only listed installs when set", async () => {
    const { POST } = await import("@/app/api/lock/unlock/route");
    await signIn("tv");
    expect((await POST(req())).status).toBe(200);
    process.env.STARTPAGE_TV_DEVICES = "install-a, install-b";
    expect((await POST(req("install-c"))).status).toBe(403);
    expect((await POST(req())).status).toBe(403);
    expect((await POST(req("install-b"))).status).toBe(200);
  });
});

describe("money + chat routes", () => {
  it("401 signed out; money 503 not_configured without a token; chat 400 on bad body", async () => {
    const money = await import("@/app/api/money/route");
    const chat = await import("@/app/api/ai/chat/route");
    const post = (b: unknown) => new NextRequest("http://t/api/ai/chat", { method: "POST", body: JSON.stringify(b) });
    expect((await money.GET()).status).toBe(401);
    expect((await chat.POST(post({ messages: [] }))).status).toBe(401);
    await signIn();
    delete process.env.LUNCHMONEY_TOKEN;
    const r = await money.GET();
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "not_configured" });
    expect((await chat.POST(post({ messages: "hi" }))).status).toBe(400);
    expect((await chat.POST(post({ messages: [{ role: "assistant", content: "hi" }] }))).status).toBe(400);
  });
});

describe("cleanMessages / buildSnapshot", () => {
  it("caps history to 12 and requires a final user turn", async () => {
    const { cleanMessages } = await import("@/lib/ai-chat");
    const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}`.repeat(1) }));
    many.push({ role: "user", content: "x".repeat(5000) });
    const out = cleanMessages(many)!;
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out[0].role).toBe("user");
    expect(out[out.length - 1].content.length).toBeLessThanOrEqual(2000 + 10);
    expect(cleanMessages([{ role: "system", content: "x" }])).toBeNull();
  });

  it("builds the money snapshot with natural signs", async () => {
    const { buildSnapshot } = await import("@/lib/money");
    const tx = (o: any) => ({ id: 1, payee: "P", currency: "gbp", category_id: 1, category_name: "Food", is_income: false, exclude_from_totals: false, has_children: false, is_group: false, group_id: null, ...o });
    const s = buildSnapshot({
      primaryCurrency: "gbp",
      assets: [
        { id: 1, type_name: "cash", name: "Current", display_name: null, balance: "1000.00", to_base: 1000, currency: "gbp", closed_on: null },
        { id: 2, type_name: "credit", name: "Card", display_name: "Amex", balance: "200.00", to_base: 200, currency: "gbp", closed_on: null },
        { id: 3, type_name: "cash", name: "Old", display_name: null, balance: "5", to_base: 5, currency: "gbp", closed_on: "2020-01-01" },
      ],
      plaid: [],
      categories: [{ id: 1, name: "Food", is_group: false, group_id: null }, { id: 2, name: "Salary", is_group: false, group_id: null }],
      transactions: [
        tx({ id: 1, date: "2026-11-10", amount: "30.00", to_base: 30 }),
        tx({ id: 2, date: "2026-11-11", amount: "-2500.00", to_base: -2500, is_income: true, category_id: 2, payee: "Employer" }),
        tx({ id: 3, date: "2026-10-30", amount: "99.00", to_base: 99 }),
      ],
    }, new Date("2026-11-13T12:00:00Z"));
    expect(s.accounts).toEqual([
      { name: "Current", balance: 1000, currency: "GBP", type: "cash" },
      { name: "Amex", balance: 200, currency: "GBP", type: "credit" },
    ]);
    expect(s.netWorth).toEqual({ amount: 800, currency: "GBP" });
    expect(s.month).toEqual({ spent: 30, income: 2500, currency: "GBP", topCategories: [{ name: "Food", amount: 30 }] });
    expect(s.recent.map((r) => [r.date, r.amount])).toEqual([["2026-11-11", 2500], ["2026-11-10", -30], ["2026-10-30", -99]]);
  });
});

describe("Aria actions + music token", () => {
  it("maps tool calls to TV actions and rejects bad ones", async () => {
    const { toAction } = await import("@/lib/ai-chat");
    const mods = ["money", "calendar"];
    expect(toAction("music_play", { query: " Kind of Blue " }, mods)).toEqual({ type: "music.play", query: "Kind of Blue" });
    expect(toAction("music_play", {}, mods)).toBeNull();
    expect(toAction("music_next", {}, mods)).toEqual({ type: "music.next" });
    expect(toAction("open_module", { module: "money" }, mods)).toEqual({ type: "open", module: "money" });
    expect(toAction("open_module", { module: "admin" }, mods)).toBeNull();
    expect(toAction("rm_rf", {}, mods)).toBeNull();
  });

  it("music token: 401 signed out, 503 unconfigured, valid ES256 JWT when configured", async () => {
    const { GET } = await import("@/app/api/music/token/route");
    for (const k of ["APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY"]) delete process.env[k];
    expect((await GET()).status).toBe(401);
    await signIn();
    expect((await GET()).status).toBe(503);
    const { generateKeyPair, exportPKCS8, jwtVerify, decodeProtectedHeader } = await import("jose");
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    process.env.APPLE_MUSIC_TEAM_ID = "TEAMID1234";
    process.env.APPLE_MUSIC_KEY_ID = "KEYID12345";
    process.env.APPLE_MUSIC_PRIVATE_KEY = await exportPKCS8(privateKey);
    const r = await GET();
    expect(r.status).toBe(200);
    const { developerToken } = await r.json();
    expect(decodeProtectedHeader(developerToken)).toEqual({ alg: "ES256", kid: "KEYID12345" });
    const { payload } = await jwtVerify(developerToken, publicKey, { issuer: "TEAMID1234" });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(12 * 3600);
  });
});

describe("owner routes accept the private unlock on the TV", () => {
  it("money/chat/token/brief: 423 before the PIN, through after a private unlock", async () => {
    hdrs.set("user-agent", TV_UA);
    const s = await signIn();  // UA-only TV session (no device stamp)
    const { requireOwner, requireSensitive } = await import("@/lib/auth");
    expect(((await requireOwner()) as Response).status).toBe(423);
    await unlock(s, "private");
    expect(await requireOwner()).toEqual({ uid: "owner-uid" });
    expect(((await requireSensitive()) as Response).status).toBe(423); // sensitive unchanged
  });
});

describe("tv location + speak", () => {
  it("parses STARTPAGE_TV_LOCATION and rejects junk", async () => {
    const { tvLocation } = await import("@/lib/tv-config");
    expect(tvLocation('{"lat":22.543,"lon":114.058,"name":"Shenzhen"}')).toEqual({ lat: 22.543, lon: 114.058, name: "Shenzhen" });
    expect(tvLocation('{"lat":200,"lon":0}')).toBeNull();
    expect(tvLocation("nope")).toBeNull();
  });
  it("speak: 401 signed out, 400 empty text", async () => {
    const { POST } = await import("@/app/api/ai/speak/route");
    const post = (b: unknown) => new NextRequest("http://t/api/ai/speak", { method: "POST", body: JSON.stringify(b) });
    expect((await POST(post({ text: "hi" }))).status).toBe(401);
    await signIn();
    expect((await POST(post({ text: "  " }))).status).toBe(400);
  });
});
