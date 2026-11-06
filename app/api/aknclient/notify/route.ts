import { authorizeAknclient } from "@/lib/aknclient-auth";
import { storeNotification } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  let body: { title?: string; body?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.title || !body.body) {
    return Response.json({ error: "title and body are required" }, { status: 400 });
  }
  const { data, error } = await storeNotification({ title: body.title, body: body.body, source: "aknclient" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data.id });
}
