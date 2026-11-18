import { NextRequest, NextResponse } from "next/server";
import { NO_STORE } from "@/lib/auth";
import { LOCK_SCOPES, UNLOCK_COOKIE, unlockCookieOptions, type LockScope } from "@/lib/lock";

export const dynamic = "force-dynamic";

/** Relock now. Body { scope } relocks one scope; no body relocks everything. */
export async function POST(req: NextRequest) {
  let scope: LockScope | undefined;
  try { scope = (await req.json())?.scope; } catch { /* no body */ }
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  for (const sc of scope && LOCK_SCOPES.includes(scope) ? [scope] : LOCK_SCOPES) {
    res.cookies.set(UNLOCK_COOKIE[sc], "", unlockCookieOptions(sc, 0));
  }
  return res;
}
