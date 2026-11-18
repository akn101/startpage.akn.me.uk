import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { fake, mockDb } from "./helpers";

mockDb();
// Cookie jar shared with the mocked next/headers.
const jar = new Map<string, string>();
vi.doMock("next/headers", () => ({ cookies: () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined) }) }));

const PIN = "482915";
let lock: typeof import("@/lib/lock");
let session: typeof import("@/lib/session");

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-session-secret-not-real-0123456789";
  process.env.STARTPAGE_OWNER_UID = "owner-uid";
  fake.tables = {}; fake.failNext = null; jar.clear();
  lock = await import("@/lib/lock");
  session = await import("@/lib/session");
  process.env.STARTPAGE_PIN_HASH = await lock.hashPin(PIN, 1000);
});

const signIn = async (device?: "tv") => {
  const token = await session.signSession({ uid: "owner-uid", role: "admin", projects: ["*"], ...(device ? { device } : {}) } as any);
  jar.set(session.SESSION_COOKIE, token);
  return (await session.verifySession(token))!;
};
const unlockReq = (pin: string, scope = "private") =>
  new NextRequest("http://t/api/lock/unlock", { method: "POST", body: JSON.stringify({ pin, scope }), headers: { "content-type": "application/json" } });

describe("PIN hashing", () => {
  it("verifies the right PIN only", async () => {
    const h = await lock.hashPin("123456", 1000);
    expect(h).toMatch(/^pbkdf2-sha256\$1000\$/);
    expect(await lock.verifyPin("123456", h)).toBe(true);
    expect(await lock.verifyPin("123457", h)).toBe(false);
    expect(await lock.verifyPin("12345", h)).toBe(false); // too short
    expect(await lock.verifyPin("123456", undefined)).toBe(false);
    expect(await lock.verifyPin("123456", "md5$1$x$y")).toBe(false);
  });
});

describe("unlock tokens", () => {
  it("are bound to session and scope", async () => {
    const a = await signIn();
    const b = await signIn();
    const t = await lock.signUnlock(a as any, "sensitive");
    expect(await lock.unlockRemaining(a as any, "sensitive", t)).toBeGreaterThan(0);
    expect(await lock.unlockRemaining(a as any, "private", t)).toBe(0);
    expect(await lock.unlockRemaining(b as any, "sensitive", t)).toBe(0);
    expect(await lock.unlockRemaining(a as any, "sensitive", "garbage")).toBe(0);
  });
});

describe("POST /api/lock/unlock", () => {
  it("401 signed out, 400 bad input, 503 without a PIN hash", async () => {
    const { POST } = await import("@/app/api/lock/unlock/route");
    expect((await POST(unlockReq(PIN))).status).toBe(401);
    await signIn();
    expect((await POST(unlockReq("12"))).status).toBe(400);
    expect((await POST(unlockReq(PIN, "root"))).status).toBe(400);
    delete process.env.STARTPAGE_PIN_HASH;
    expect((await POST(unlockReq(PIN))).status).toBe(503);
  });

  it("sets both cookies on a right sensitive PIN", async () => {
    const { POST } = await import("@/app/api/lock/unlock/route");
    await signIn();
    const r = await POST(unlockReq(PIN, "sensitive"));
    expect(r.status).toBe(200);
    const set = r.headers.getSetCookie().join("\n");
    expect(set).toMatch(/sp_unlock_s=/);
    expect(set).toMatch(/sp_unlock=/);
    expect(set).toMatch(/HttpOnly/i);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("locks out after 5 wrong PINs, even for the right one", async () => {
    const { POST } = await import("@/app/api/lock/unlock/route");
    await signIn();
    for (let i = 0; i < 4; i++) {
      const r = await POST(unlockReq("000000"));
      expect(r.status).toBe(401);
      expect((await r.json()).remaining).toBe(4 - i);
    }
    expect((await POST(unlockReq("000000"))).status).toBe(429);
    expect((await POST(unlockReq(PIN))).status).toBe(429);
  });
});

describe("middleware", () => {
  const mw = async (path: string, cookies: Record<string, string>) => {
    const { middleware } = await import("@/middleware");
    const req = new NextRequest(`http://t${path}`, { method: "POST", headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } });
    return middleware(req);
  };

  it("refuses APIs with 423 for a locked TV, allows them once unlocked", async () => {
    const tv = await signIn("tv");
    const tok = jar.get(session.SESSION_COOKIE)!;
    expect((await mw("/api/data/todos", { sp_session: tok })).status).toBe(423);
    expect((await mw("/api/lock/unlock", { sp_session: tok })).status).toBe(200);
    const u = await lock.signUnlock(tv as any, "private");
    expect((await mw("/api/data/todos", { sp_session: tok, sp_unlock: u })).status).toBe(200);
  });

  it("does not lock a browser session", async () => {
    await signIn();
    expect((await mw("/api/data/todos", { sp_session: jar.get(session.SESSION_COOKIE)! })).status).toBe(200);
  });
});
