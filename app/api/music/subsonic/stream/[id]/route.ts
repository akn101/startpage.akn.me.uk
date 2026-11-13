import { NO_STORE } from "@/lib/auth";
import { proxy, validId } from "@/lib/subsonic";
import { subsonicRoute } from "@/lib/subsonic-route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Audio bytes for one track, Range passed through so the player can seek. Owner profile only. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return subsonicRoute("stream", async () => {
    if (!validId(params.id)) return Response.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
    return proxy("stream", { id: params.id }, req);
  });
}
