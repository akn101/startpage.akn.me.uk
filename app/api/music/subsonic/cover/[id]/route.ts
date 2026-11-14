import { NO_STORE } from "@/lib/auth";
import { proxy, validId } from "@/lib/subsonic";
import { subsonicRoute } from "@/lib/subsonic-route";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Cover art (600px). Owner profile only. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return subsonicRoute("cover", async () => {
    if (!validId(params.id)) return Response.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
    return proxy("getCoverArt", { id: params.id, size: 600 }, req);
  });
}
