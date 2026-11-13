import { getRawSession, hasAccess, isUnlocked, NO_STORE, requestDevice } from "@/lib/auth";
import { isTvSession, isTvUserAgent, pinApplies, sessionKey } from "@/lib/lock";
import { lockedUntil } from "@/lib/pin-attempts";

export const dynamic = "force-dynamic";

// The PIN is TV-only: browsers and other devices are told no PIN is configured.
export async function GET() {
  const { ua } = requestDevice();
  const s = await getRawSession();
  if (!s || !hasAccess(s)) {
    return Response.json({ signedIn: false, pinConfigured: pinApplies(null, ua) }, { headers: NO_STORE });
  }
  const tv = isTvSession(s) || isTvUserAgent(ua);
  const [priv, sens, until] = await Promise.all([
    isUnlocked(s, "private"),
    isUnlocked(s, "sensitive"),
    lockedUntil(sessionKey(s)),
  ]);
  return Response.json(
    {
      signedIn: true,
      device: tv ? "tv" : "browser",
      pinConfigured: pinApplies(s, ua),
      // Non-TV sessions are never "private"-locked, and never PIN-gated for "sensitive".
      unlocked: { private: !isTvSession(s) || priv, sensitive: !pinApplies(s, ua) || sens },
      lockedUntil: until || null,
    },
    { headers: NO_STORE },
  );
}
