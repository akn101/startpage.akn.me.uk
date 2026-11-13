import { requireOwner, NO_STORE } from "@/lib/auth";
import { aiBrief, gatherBrief } from "@/lib/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Morning brief on demand. PIN-gated: it reads Mind and Bonds. */
export async function GET() {
  const g = await requireOwner();
  if (g instanceof Response) return g;
  const input = await gatherBrief(g.uid);
  const { text, ai } = await aiBrief(input);
  return Response.json({ text, ai, at: input.now }, { headers: NO_STORE });
}
