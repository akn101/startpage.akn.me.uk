import { requireSensitive, NO_STORE } from "@/lib/auth";
import { developerToken, musicConfigured } from "@/lib/apple-music";

export const dynamic = "force-dynamic";

/** MusicKit JS developer token. Owner profile only (PIN-unlocked on the TV). */
export async function GET() {
  const g = await requireSensitive();
  if (g instanceof Response) return g;
  if (!musicConfigured()) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  try {
    const { token, exp } = await developerToken();
    return Response.json({ developerToken: token, exp }, { headers: NO_STORE });
  } catch (e) {
    console.error("music/token: signing failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "bad_key" }, { status: 500, headers: NO_STORE });
  }
}
