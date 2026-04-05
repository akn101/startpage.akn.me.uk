import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "./session";

export async function getAuthSession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

function hasAccess(session: { role: string; projects: string[] }): boolean {
  return (
    session.role === "admin" ||
    session.projects.includes("*") ||
    session.projects.includes("startpage")
  );
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getAuthSession();
  return !!(session && hasAccess(session));
}

export async function requireAuth(): Promise<Response | null> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// Returns the uid for the authenticated user, or null
export async function getUid(): Promise<string | null> {
  const session = await getAuthSession();
  if (!session || !hasAccess(session)) return null;
  // Map legacy 'local' uid (pre-migration access code sessions) to owner uid
  if (session.uid === 'local') return process.env.STARTPAGE_OWNER_UID ?? session.uid;
  return session.uid;
}

// Returns { uid } or a 401 Response
export async function requireUid(): Promise<{ uid: string } | Response> {
  const uid = await getUid();
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return { uid };
}

// Admin = role:admin or projects includes startpage-admin
export async function isAdmin(): Promise<boolean> {
  const session = await getAuthSession();
  if (!session) return false;
  return session.role === "admin" || session.projects.includes("startpage-admin");
}
