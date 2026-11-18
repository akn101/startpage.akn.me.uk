// PIN locks. Edge-safe (jose + WebCrypto only) so middleware can use it.
//
// Two scopes:
//   private   — TV sessions only. A TV signed in with the access code sees
//               nothing private until the PIN is entered; it relocks after
//               UNLOCK_TTL.private or when the TV idles / leaves the app.
//   sensitive — TV only. Routes that call requireSensitive() (finance,
//               bonds, anything you'd not want on a shared screen) need a
//               fresh PIN entry no older than UNLOCK_TTL.sensitive when the
//               caller is the TV. Browsers and other devices behave as if no
//               PIN were configured (owner ruling: the PIN is for the TV only).
//
// An unlock is a short JWT in its own httpOnly cookie, bound to the session
// it was issued for (sid), so it can't be replayed with another session.
import { SignJWT, jwtVerify } from "jose";
import type { SessionData } from "./session";

export type LockScope = "private" | "sensitive";
export const LOCK_SCOPES: LockScope[] = ["private", "sensitive"];

export const UNLOCK_COOKIE: Record<LockScope, string> = {
  private: "sp_unlock",
  sensitive: "sp_unlock_s",
};
export const UNLOCK_TTL: Record<LockScope, number> = {
  private: 15 * 60, // seconds; extended by /api/lock/touch while in use
  sensitive: 3 * 60, // never extended
};

export const TV_UA = "StartpageTV";
export const isTvUserAgent = (ua: string | null | undefined) => !!ua && ua.includes(TV_UA);
/** The native TV app sends a random per-install id. Logged; optionally allowlisted for unlock (STARTPAGE_TV_DEVICES); never required otherwise. */
export const TV_DEVICE_HEADER = "x-startpage-device";

export type Session = SessionData & { iat?: number };
export const isTvSession = (s: Session | null | undefined) => s?.device === "tv";

/** Stable id for a session. Pre-sid sessions fall back to uid + issue time. */
export const sessionKey = (s: Session) => s.sid ?? `${s.uid}:${s.iat ?? 0}`;

function unlockSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set");
  // Separate key from the session JWT so one can never stand in for the other.
  return new TextEncoder().encode(`${s}\u0000sp-unlock`);
}

export async function signUnlock(s: Session, scope: LockScope): Promise<string> {
  return new SignJWT({ sid: sessionKey(s), scope })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("sp-unlock")
    .setIssuedAt()
    .setExpirationTime(`${UNLOCK_TTL[scope]}s`)
    .sign(unlockSecret());
}

/** Seconds left on a valid unlock for this session + scope, else 0. */
export async function unlockRemaining(
  s: Session,
  scope: LockScope,
  token: string | undefined,
): Promise<number> {
  if (!token) return 0;
  try {
    const { payload } = await jwtVerify(token, unlockSecret(), { audience: "sp-unlock" });
    if (payload.sid !== sessionKey(s) || payload.scope !== scope) return 0;
    return Math.max(0, (payload.exp ?? 0) - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

export function unlockCookieOptions(scope: LockScope, maxAge = UNLOCK_TTL[scope]) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

// ── PIN hashing: PBKDF2-SHA256, stored as pbkdf2-sha256$<iter>$<salt>$<hash> ──

export const PIN_RE = /^\d{6,12}$/;
const ITERATIONS = 210_000;

const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64u(salt)}$${b64u(await derive(pin, salt, iterations))}`;
}

export async function verifyPin(pin: string, stored: string | undefined): Promise<boolean> {
  if (!stored || !PIN_RE.test(pin)) return false;
  const [alg, it, salt, hash] = stored.split("$");
  const iterations = Number(it);
  if (alg !== "pbkdf2-sha256" || !Number.isInteger(iterations) || !salt || !hash) return false;
  const got = await derive(pin, unb64u(salt), iterations);
  const want = unb64u(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export const pinConfigured = () => !!process.env.STARTPAGE_PIN_HASH;

/** Does the PIN apply to this caller? Only on the TV (a TV session, or a TV user agent). */
export const pinApplies = (s: Session | null | undefined, ua: string | null | undefined) =>
  pinConfigured() && (isTvSession(s) || isTvUserAgent(ua));
