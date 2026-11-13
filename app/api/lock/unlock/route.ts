import { NextRequest, NextResponse } from "next/server";
import { getRawSession, hasAccess, NO_STORE } from "@/lib/auth";
import { deviceTag, tvDeviceAllowed } from "@/lib/tv-config";
import { isTvSession, isTvUserAgent, TV_DEVICE_HEADER, LOCK_SCOPES, PIN_RE, signUnlock, sessionKey, unlockCookieOptions, UNLOCK_COOKIE, verifyPin, type LockScope } from "@/lib/lock";
import { clearFailures, lockedUntil, recordFailure } from "@/lib/pin-attempts";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await getRawSession();
  if (!s || !hasAccess(s)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const stored = process.env.STARTPAGE_PIN_HASH;
  if (!stored) return NextResponse.json({ error: "pin_not_configured" }, { status: 503, headers: NO_STORE });

  let body: { pin?: unknown; scope?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const scope = (body.scope ?? "private") as LockScope;
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!LOCK_SCOPES.includes(scope) || !PIN_RE.test(pin)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }

  // Optional STARTPAGE_TV_DEVICES allowlist: which TV installs may unlock the owner profile.
  const device = req.headers.get(TV_DEVICE_HEADER);
  const tv = isTvSession(s) || isTvUserAgent(req.headers.get("user-agent"));
  if (tv && !tvDeviceAllowed(device)) {
    console.warn(`lock/unlock: TV device ${deviceTag(device)} not in allowlist`);
    return NextResponse.json({ error: "device_not_allowed" }, { status: 403, headers: NO_STORE });
  }

  const key = sessionKey(s);
  const until = await lockedUntil(key);
  if (until) return NextResponse.json({ error: "locked_out", lockedUntil: until }, { status: 429, headers: NO_STORE });

  if (!(await verifyPin(pin, stored))) {
    const r = await recordFailure(key);
    return NextResponse.json(
      r.lockedUntil
        ? { error: "locked_out", lockedUntil: r.lockedUntil }
        : { error: "wrong_pin", remaining: r.remaining },
      { status: r.lockedUntil ? 429 : 401, headers: NO_STORE },
    );
  }

  await clearFailures(key);
  if (tv) console.log(`lock/unlock: TV device ${deviceTag(device)} unlocked ${scope}`);
  const res = NextResponse.json({ ok: true, scope }, { headers: NO_STORE });
  // A sensitive unlock also opens the private scope (one PIN entry, not two).
  const scopes: LockScope[] = scope === "sensitive" ? ["private", "sensitive"] : ["private"];
  for (const sc of scopes) res.cookies.set(UNLOCK_COOKIE[sc], await signUnlock(s, sc), unlockCookieOptions(sc));
  return res;
}
