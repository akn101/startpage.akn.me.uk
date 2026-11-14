import { NextRequest } from "next/server";
import { requireOwner, NO_STORE } from "@/lib/auth";
import { getCachedBrief } from "@/lib/brief-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Morning brief, cached for an hour per user (regenerated on read when stale).
 * `?refresh=1` regenerates if the cached one is over five minutes old.
 * PIN-gated on the TV: it reads Mind and Bonds.
 */
export async function GET(req: NextRequest) {
  const g = await requireOwner();
  if (g instanceof Response) return g;
  const force = req?.nextUrl?.searchParams.get("refresh") === "1";
  return Response.json(await getCachedBrief(g.uid, { force }), { headers: NO_STORE });
}
