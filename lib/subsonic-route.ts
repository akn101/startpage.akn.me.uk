import { requireOwner, NO_STORE } from "@/lib/auth";
import { SubsonicError, SubsonicNotConfigured, subsonicConfigured } from "@/lib/subsonic";

/** Owner gate + config check + uniform errors for the /api/music/subsonic/* routes. */
export async function subsonicRoute(label: string, fn: () => Promise<Response>): Promise<Response> {
  const g = await requireOwner();
  if (g instanceof Response) return g;
  if (!subsonicConfigured()) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SubsonicNotConfigured) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
    console.error(`subsonic/${label}:`, e instanceof SubsonicError ? e.message : e instanceof Error ? e.message : e);
    return Response.json({ error: "upstream_failed" }, { status: 502, headers: NO_STORE });
  }
}
