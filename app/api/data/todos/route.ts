import { db } from "@/lib/supabase-server";
import { getUid, requireUid } from "@/lib/auth";
import { listTodos } from "@/lib/todos";

export async function GET() {
  const uid = await getUid();
  const { data, error } = await listTodos(uid);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ todos: data ?? [] });
}

export async function POST(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;
  const { text } = await req.json();
  const { data, error } = await db.from("todos")
    .insert({ text, done: false, user_id: uid })
    .select("id, text, done, is_public").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ todo: data });
}

export async function PATCH(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;
  const { id, done, is_public } = await req.json();
  const updates: Record<string, unknown> = {};
  if (done !== undefined) updates.done = done;
  if (is_public !== undefined) updates.is_public = is_public;
  const { error } = await db.from("todos").update(updates).eq("id", id).eq("user_id", uid);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;
  const { ids } = await req.json();
  const { error } = await db.from("todos").delete().in("id", ids).eq("user_id", uid);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
