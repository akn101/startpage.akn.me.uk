import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Service-key auth for /api/aknclient/*.
 * Returns null when the request is authorised, otherwise the Response to send.
 * Missing env var -> 503, missing/invalid key -> 401. Comparison is constant time
 * (both sides hashed to equal length first).
 */
export function authorizeAknclient(req: Request): Response | null {
  const expected = process.env.AKNCLIENT_API_KEY;
  if (!expected) {
    return Response.json({ error: "AKNCLIENT_API_KEY not configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/** The startpage owner's uid, needed so aknclient rows show in the owner's own views. */
export function ownerUid(): string | null {
  return process.env.STARTPAGE_OWNER_UID || null;
}

export function missingOwner(): Response {
  return Response.json({ error: "STARTPAGE_OWNER_UID not configured" }, { status: 503 });
}
