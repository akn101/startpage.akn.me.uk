import { authorizeAknclient, missingOwner, ownerUid } from "@/lib/aknclient-auth";
import { listTodos, setTodoDone } from "@/lib/todos";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  const uid = ownerUid();
  if (!uid) return missingOwner();
  const { data, error } = await listTodos(uid);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ todos: data ?? [] });
}

export async function PATCH(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  const uid = ownerUid();
  if (!uid) return missingOwner();
  let body: { id?: unknown; done?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.id !== "string" || !body.id || typeof body.done !== "boolean") {
    return Response.json({ error: "id (string) and done (boolean) are required" }, { status: 400 });
  }
  const { data, error } = await setTodoDone(uid, body.id, body.done);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(data);
}
