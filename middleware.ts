import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "sp_session";

async function hasSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const p = payload as { role?: string; projects?: string[] };
    return !!(p.role === "admin" || p.projects?.includes("*") || p.projects?.includes("startpage"));
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow: auth endpoints, access page, notify webhook
  if (
    pathname.startsWith("/access") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/notify") ||
    pathname.startsWith("/api/aknclient/") || // own service-key auth in each route

    pathname.startsWith("/api/notifications")
  ) {
    return NextResponse.next();
  }

  // Public GET: home page and data API (routes filter public vs private rows internally)
  if (req.method === "GET") {
    if (
      pathname === "/" ||
      pathname.startsWith("/api/data/")
    ) {
      return NextResponse.next();
    }
  }

  // Everything else requires a valid session
  if (!(await hasSession(req))) {
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
