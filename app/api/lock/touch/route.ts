import { NextResponse } from "next/server";
import { getRawSession, hasAccess, isUnlocked, NO_STORE } from "@/lib/auth";
import { signUnlock, unlockCookieOptions, UNLOCK_COOKIE } from "@/lib/lock";

export const dynamic = "force-dynamic";

/** Extend a live private unlock while the TV is in use. Never extends "sensitive". */
export async function POST() {
  const s = await getRawSession();
  if (!s || !hasAccess(s) || !(await isUnlocked(s, "private"))) {
    return NextResponse.json({ ok: false }, { status: 423, headers: NO_STORE });
  }
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(UNLOCK_COOKIE.private, await signUnlock(s, "private"), unlockCookieOptions("private"));
  return res;
}
