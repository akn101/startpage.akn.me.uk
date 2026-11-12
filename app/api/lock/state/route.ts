import { getRawSession, hasAccess, isUnlocked, NO_STORE } from "@/lib/auth";
import { isTvSession, pinConfigured, sessionKey } from "@/lib/lock";
import { lockedUntil } from "@/lib/pin-attempts";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getRawSession();
  if (!s || !hasAccess(s)) {
    return Response.json({ signedIn: false, pinConfigured: pinConfigured() }, { headers: NO_STORE });
  }
  const [priv, sens, until] = await Promise.all([
    isUnlocked(s, "private"),
    isUnlocked(s, "sensitive"),
    lockedUntil(sessionKey(s)),
  ]);
  return Response.json(
    {
      signedIn: true,
      device: isTvSession(s) ? "tv" : "browser",
      pinConfigured: pinConfigured(),
      // Non-TV sessions are never "private"-locked.
      unlocked: { private: !isTvSession(s) || priv, sensitive: sens },
      lockedUntil: until || null,
    },
    { headers: NO_STORE },
  );
}
