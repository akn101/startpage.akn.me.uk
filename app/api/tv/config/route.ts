import { getRawSession, hasAccess, isUnlocked, NO_STORE, requestDevice } from "@/lib/auth";
import { isTvSession, isTvUserAgent, pinApplies, pinConfigured } from "@/lib/lock";
import { tvLocation, tvModules, type TvProfile } from "@/lib/tv-config";
import { activeMusicBackend } from "@/lib/music-backend";
import { macActive } from "@/lib/mac-music";

export const dynamic = "force-dynamic";

/**
 * Which dashboard the TV shows. No secrets. Guest (anyone, any install) gets
 * public modules; the owner's profile needs a signed-in session that is
 * PIN-unlocked ("private") on the TV (off the TV, no PIN applies).
 */
export async function GET() {
  const { ua } = requestDevice();
  const s = await getRawSession();
  let profile: TvProfile = "guest";
  if (s && hasAccess(s)) {
    const tv = isTvSession(s) || isTvUserAgent(ua);
    // On the TV the owner profile follows the "private" unlock (15 min, kept alive by /api/lock/touch).
    const privOk = !(isTvSession(s) || pinApplies(s, ua)) || (await isUnlocked(s, "private"));
    // A TV with no PIN configured can never unlock, so it stays guest.
    if (privOk && (!tv || pinConfigured())) profile = "owner";
  }
  const modules = tvModules()[profile];
  return Response.json(
    {
      profile,
      modules,
      pinConfigured: pinApplies(s, ua),
      location: tvLocation(),
      // Which player /tv/music uses: "apple" (MusicKit), "subsonic" (our proxy) or null (none set up).
      // "mac": the owner's own Music.app (their Apple Music account), relayed by aknClient through /api/music/mac.
      music: { backend: profile === "owner" && (await macActive()) ? "mac" : activeMusicBackend() },
      ...(profile === "owner" && s?.displayName ? { displayName: s.displayName } : {}),
    },
    { headers: NO_STORE },
  );
}

