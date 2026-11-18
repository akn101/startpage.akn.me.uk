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
    expect(await (await GET()).json()).toEqual({ profile: "guest", modules: ["clock", "weather"], pinConfigured: true, location: null, music: { backend: null } });
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
    const tx = (o: any) => ({ id: 1, payee: "Pret", currency: "gbp", category_id: 1, category_name: "Food", is_income: false, exclude_from_totals: false, has_children: false, is_group: false, group_id: null, ...o });
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
      { name: "Current", institution: "", balance: 1000, currency: "GBP", type: "cash", liability: false },
      { name: "Amex", institution: "", balance: 200, currency: "GBP", type: "credit", liability: true },
    ]);
    expect(s.byCurrency).toEqual([{ currency: "GBP", total: 800, accounts: s.accounts }]);
    expect(s.netWorth).toEqual({ amount: 800, currency: "GBP" });
    expect(s.month).toEqual({
      spent: 30, income: 2500, currency: "GBP", topCategories: [{ name: "Food", amount: 30 }], uncategorised: 0,
      largest: [{ date: "2026-11-10", payee: "Pret", amount: -30, currency: "GBP", category: "Food" }],
    });
    expect(s.upcoming).toEqual([]);
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

describe("subsonic fallback", () => {
  const SUB = { SUBSONIC_URL: "https://music.example.test/", SUBSONIC_USER: "u1", SUBSONIC_PASSWORD: "pw-not-real" };
  const setSub = () => Object.assign(process.env, SUB);
  const clearSub = () => { for (const k of Object.keys(SUB)) delete process.env[k]; };
  const clearApple = () => { for (const k of ["APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY"]) delete process.env[k]; };
  const ok = (body: unknown) => new Response(JSON.stringify({ "subsonic-response": { status: "ok", ...(body as object) } }), { headers: { "content-type": "application/json" } });

  beforeEach(() => { clearSub(); clearApple(); vi.unstubAllGlobals(); });

  it("token+salt auth: t = md5(password+salt); password never in the URL", async () => {
    setSub();
    const { endpoint, authParams } = await import("@/lib/subsonic");
    const { createHash } = await import("node:crypto");
    const p = authParams("abc123");
    expect(p.get("t")).toBe(createHash("md5").update("pw-not-real" + "abc123").digest("hex"));
    expect(Object.fromEntries(p)).toMatchObject({ u: "u1", s: "abc123", v: "1.16.1", c: "startpage", f: "json" });
    const url = endpoint("ping");
    expect(url.startsWith("https://music.example.test/rest/ping.view?")).toBe(true);
    expect(url).not.toContain("pw-not-real");
  });

  it("search/random: 401 signed out, 503 unconfigured, proxied track URLs when configured", async () => {
    const search = (await import("@/app/api/music/subsonic/search/route")).GET;
    const random = (await import("@/app/api/music/subsonic/random/route")).GET;
    const req = (q: string) => new NextRequest(`http://t/api/music/subsonic/search?q=${encodeURIComponent(q)}`);
    expect((await search(req("x"))).status).toBe(401);
    expect((await random()).status).toBe(401);
    await signIn();
    expect((await search(req("x"))).status).toBe(503);
    setSub();
    expect((await search(req(" "))).status).toBe(400);
    const fetchMock = vi.fn(async () => ok({ searchResult3: { song: [
      { id: "tr-1", title: "So What", artist: "Miles Davis", album: "Kind of Blue", coverArt: "al-9", duration: 562 },
      { id: "bad id/../x", title: "nope" },
    ] } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await search(req("kind of blue"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ id: "tr-1", title: "So What", artist: "Miles Davis", album: "Kind of Blue",
      coverUrl: "/api/music/subsonic/cover/al-9", streamUrl: "/api/music/subsonic/stream/tr-1", duration: 562 }]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/rest/search3.view?");
    vi.stubGlobal("fetch", vi.fn(async () => ok({ randomSongs: { song: { id: "tr-2", title: "Solo" } } })));
    expect((await (await random()).json())[0]).toMatchObject({ id: "tr-2", streamUrl: "/api/music/subsonic/stream/tr-2" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ "subsonic-response": { status: "failed", error: { code: 40, message: "Wrong username or password" } } }))));
    expect((await random()).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://id.example.test/" } })));
    expect((await random()).status).toBe(502);
  });

  it("stream: passes Range through and returns 206; rejects odd ids; error envelope → 502", async () => {
    const { GET } = await import("@/app/api/music/subsonic/stream/[id]/route");
    const req = () => new Request("http://t/api/music/subsonic/stream/tr-1", { headers: { range: "bytes=100-199" } });
    expect((await GET(req(), { params: { id: "tr-1" } })).status).toBe(401);
    await signIn(); setSub();
    expect((await GET(req(), { params: { id: "../etc" } })).status).toBe(400);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(100), { status: 206, headers: {
      "content-type": "audio/mpeg", "content-range": "bytes 100-199/5000", "content-length": "100", "accept-ranges": "bytes" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await GET(req(), { params: { id: "tr-1" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 100-199/5000");
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(init.headers.range).toBe("bytes=100-199");
    vi.stubGlobal("fetch", vi.fn(async () => ok({})));
    expect((await GET(req(), { params: { id: "tr-1" } })).status).toBe(502);
  });

  it("tv/config music.backend: apple > subsonic > null; Aria's play action keeps its shape", async () => {
    const { activeMusicBackend } = await import("@/lib/music-backend");
    expect(activeMusicBackend()).toBeNull();
    setSub();
    expect(activeMusicBackend()).toBe("subsonic");
    Object.assign(process.env, { APPLE_MUSIC_TEAM_ID: "T", APPLE_MUSIC_KEY_ID: "K", APPLE_MUSIC_PRIVATE_KEY: "P" });
    expect(activeMusicBackend()).toBe("apple");
    clearApple();
    const { GET } = await import("@/app/api/tv/config/route");
    expect((await (await GET()).json()).music).toEqual({ backend: "subsonic" });
    const { toAction } = await import("@/lib/ai-chat");
    expect(toAction("music_play", { query: "jazz" }, ["ask"])).toEqual({ type: "music.play", query: "jazz" });
    clearSub();
  });
});
