import { getRawSession, hasAccess, isUnlocked, NO_STORE } from "@/lib/auth";
import { isTvSession } from "@/lib/lock";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getRawSession();
  if (!s || !hasAccess(s)) return Response.json({ authenticated: false }, { headers: NO_STORE });
  // A locked TV is reported as signed out (with locked:true so the client can show the PIN pad).
  if (isTvSession(s) && !(await isUnlocked(s, "private"))) {
    return Response.json({ authenticated: false, locked: true, device: "tv" }, { headers: NO_STORE });
  }
  return Response.json(
    {
      authenticated: true,
      uid: s.uid,
      email: s.email,
      role: s.role,
      projects: s.projects,
      ...(isTvSession(s) ? { device: "tv" } : {}),
    },
    { headers: NO_STORE },
  );
}
