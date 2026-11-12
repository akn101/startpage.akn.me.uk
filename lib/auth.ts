import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "./session";
import { isTvSession, unlockRemaining, UNLOCK_COOKIE, type LockScope, type Session } from "./lock";

/** The signed-in session, ignoring PIN locks. Only the lock routes and
 *  /api/auth/status should need this; everything else uses getAuthSession. */
export async function getRawSession(): Promise<Session | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token) as Promise<Session | null>;
}

export async function isUnlocked(session: Session, scope: LockScope): Promise<boolean> {
  return (await unlockRemaining(session, scope, cookies().get(UNLOCK_COOKIE[scope])?.value)) > 0;
}

/** The session, or null. A TV session counts as signed out until its PIN is entered. */
export async function getAuthSession(): Promise<Session | null> {
  const session = await getRawSession();
  if (!session) return null;
  if (isTvSession(session) && !(await isUnlocked(session, "private"))) return null;
  return session;
}

export function hasAccess(session: { role: string; projects: string[] }): boolean {
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

/**
 * Gate for sensitive data (finance, bonds, …) on every device: signed in AND
 * the PIN entered within the last few minutes. Responds 423 with
 * { error: "pin_required", scope: "sensitive" } so <PinGate> can prompt.
 * Wrap the data route:  const g = await requireSensitive(); if (g instanceof Response) return g;
 */
export async function requireSensitive(): Promise<{ uid: string } | Response> {
  const session = await getAuthSession();
  const uid = await getUid();
  if (!session || !uid) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!(await isUnlocked(session, "sensitive"))) {
    return Response.json(
      { error: "pin_required", scope: "sensitive" },
      { status: 423, headers: NO_STORE },
    );
  }
  return { uid };
}

export const NO_STORE = { "Cache-Control": "no-store, private" };

// Admin = role:admin or projects includes startpage-admin
export async function isAdmin(): Promise<boolean> {
  const session = await getAuthSession();
  if (!session) return false;
  return session.role === "admin" || session.projects.includes("startpage-admin");
}
