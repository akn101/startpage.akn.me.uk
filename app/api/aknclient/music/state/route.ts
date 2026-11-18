import { authorizeAknclient } from "@/lib/aknclient-auth";
import { cleanArtwork, cleanState, saveState } from "@/lib/mac-music";

export const dynamic = "force-dynamic";

/** PUT {state|null, trackId, artwork?} from aknClient: what Music.app on the owner's Mac is playing. */
export async function PUT(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  let body: { state?: unknown; trackId?: unknown; artwork?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const trackId = typeof body.trackId === "string" ? body.trackId.slice(0, 200) : null;
  const { error } = await saveState(cleanState(body.state), trackId, cleanArtwork(body.artwork));
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
