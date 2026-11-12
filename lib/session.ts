import { SignJWT, jwtVerify } from 'jose';

export interface SessionData {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string;
  projects: string[];
  /** Random per-sign-in id; PIN unlocks are bound to it. */
  sid?: string;
  /** "tv" when signed in from the Startpage TV app: private data needs the PIN. */
  device?: "tv";
}

export const SESSION_COOKIE = 'sp_session';
export const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET not set');
  return new TextEncoder().encode(s);
}

export async function signSession(data: SessionData): Promise<string> {
  return new SignJWT({ ...data, sid: data.sid ?? crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionData;
  } catch {
    return null;
  }
}
