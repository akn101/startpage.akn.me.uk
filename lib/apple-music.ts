// Apple Music developer token for MusicKit JS: an ES256 JWT signed with a
// Media Services (MusicKit) key. iss = Apple team id, kid = key id, exp ≤ 12h.
import { SignJWT, importPKCS8 } from "jose";

export const MUSIC_TOKEN_TTL_S = 12 * 3600;

export function musicConfigured(): boolean {
  return !!(process.env.APPLE_MUSIC_TEAM_ID && process.env.APPLE_MUSIC_KEY_ID && process.env.APPLE_MUSIC_PRIVATE_KEY);
}

/** Accepts the .p8 file contents, or the same with literal "\n"s (as some env UIs store it). */
const pem = (k: string) => k.replace(/\\n/g, "\n").trim();

let cache: { token: string; exp: number } | null = null;

export async function mintDeveloperToken(
  opts = { teamId: process.env.APPLE_MUSIC_TEAM_ID!, keyId: process.env.APPLE_MUSIC_KEY_ID!, privateKey: process.env.APPLE_MUSIC_PRIVATE_KEY! },
  now = Math.floor(Date.now() / 1000),
): Promise<{ token: string; exp: number }> {
  const key = await importPKCS8(pem(opts.privateKey), "ES256");
  const exp = now + MUSIC_TOKEN_TTL_S;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: opts.keyId })
    .setIssuer(opts.teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
  return { token, exp };
}

/** Cached until an hour before expiry. */
export async function developerToken(): Promise<{ token: string; exp: number }> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.exp - now > 3600) return cache;
  cache = await mintDeveloperToken(undefined, now);
  return cache;
}
