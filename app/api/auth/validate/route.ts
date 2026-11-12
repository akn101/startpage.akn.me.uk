import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_COOKIE, TTL_SECONDS } from "@/lib/session";
import { isTvUserAgent } from "@/lib/lock";

// In-memory rate limiter: 5 attempts per minute per IP
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let code: unknown;
  try { ({ code } = await req.json()); } catch { code = undefined; }

  if (!code || code !== process.env.STARTPAGE_ACCESS_CODE) {
    return NextResponse.json({ error: "Invalid access code" }, { status: 401 });
  }

  // Clear rate limit on success
  attempts.delete(ip);

  const token = await signSession({
    uid: process.env.STARTPAGE_OWNER_UID ?? "owner",
    email: null,
    displayName: null,
    role: "admin",
    projects: ["*"],
    // The TV app's sessions stay PIN-locked until unlocked (see lib/lock.ts).
    ...(isTvUserAgent(req.headers.get("user-agent")) ? { device: "tv" as const } : {}),
  });

  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return res;
}
