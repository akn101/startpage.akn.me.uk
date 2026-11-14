import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { isTvSession, unlockRemaining, UNLOCK_COOKIE, type Session } from "@/lib/lock";

const SESSION_COOKIE = "sp_session";

type State = "none" | "ok" | "locked";

async function sessionState(req: NextRequest): Promise<State> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return "none";
  const secret = process.env.SESSION_SECRET;
  if (!secret) return "none";
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const p = payload as unknown as Session;
    const access = !!(p.role === "admin" || p.projects?.includes("*") || p.projects?.includes("startpage"));
    if (!access) return "none";
    // A TV session is locked until its PIN unlock cookie is present and valid.
    if (isTvSession(p)) {
      const left = await unlockRemaining(p, "private", req.cookies.get(UNLOCK_COOKIE.private)?.value);
      if (left <= 0) return "locked";
    }
    return "ok";
  } catch {
    return "none";
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow: auth endpoints, access page, notify webhook, PIN lock
  // endpoints (they check the session themselves), deploy version.
  if (
    pathname.startsWith("/access") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/lock/") ||
    pathname === "/api/version" ||
    pathname === "/api/tv/config" || // generic TV dashboard config; checks the session itself
    pathname.startsWith("/api/notify") ||
    pathname.startsWith("/api/aknclient/") || // own service-key auth in each route

    pathname.startsWith("/api/notifications")
  ) {
    return NextResponse.next();
  }

  // Public GET: home page and data API (routes filter public vs private rows internally,
  // and treat a locked TV session as signed out — see lib/auth.ts)
  if (req.method === "GET") {
    if (
      pathname === "/" ||
      pathname.startsWith("/api/data/")
    ) {
      return NextResponse.next();
    }
  }

  const state = await sessionState(req);
  if (state === "locked") {
    // Signed-in TV without its PIN: APIs refuse; pages render and the client shows the PIN pad.
    if (pathname.startsWith("/api/")) {
      return Response.json(
        { error: "locked", scope: "private" },
        { status: 423, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.next();
  }

  // Everything else requires a valid session
  if (state !== "ok") {
    if (pathname.startsWith("/api/")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/access";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|workbox.*).*)" ],
};
