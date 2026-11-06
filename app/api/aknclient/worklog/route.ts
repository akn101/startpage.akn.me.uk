import { authorizeAknclient, missingOwner, ownerUid } from "@/lib/aknclient-auth";
import { parseWorklog, syncAknclientBlocks } from "@/lib/time-sessions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  const uid = ownerUid();
  if (!uid) return missingOwner();

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = parseWorklog(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const res = await syncAknclientBlocks(uid, parsed.blocks, parsed.range);
  if ("error" in res) return Response.json({ error: res.error }, { status: 500 });
  return Response.json(res);
}
