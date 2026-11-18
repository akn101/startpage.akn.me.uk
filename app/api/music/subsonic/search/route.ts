import { NextRequest } from "next/server";
import { NO_STORE } from "@/lib/auth";
import { search } from "@/lib/subsonic";
import { subsonicRoute } from "@/lib/subsonic-route";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** GET ?q= → [{id,title,artist,album,coverUrl,streamUrl,duration}]. Owner profile only. */
export async function GET(req: NextRequest) {
  return subsonicRoute("search", async () => {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (!q) return Response.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
    return Response.json(await search(q), { headers: NO_STORE });
  });
}
