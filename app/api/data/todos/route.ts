import { db } from "@/lib/supabase-server";
import { getUid, requireOwner, requireUid } from "@/lib/auth";
import { listTodos } from "@/lib/todos";
import { bondsConfigured, bondsSnapshot, setBondsTaskDone } from "@/lib/bonds";
import { parseBondsTodoId } from "@/lib/todo-sync";

/**
 * { todos } as before (startpage rows), plus Bonds vault tasks for the owner:
 * { bonds: [...] } when readable, { bondsLocked: true } on a TV that needs the PIN.
 * Bonds is only consulted when it is configured.
 */
export async function GET() {
  const uid = await getUid();
  const [{ data, error }, bonds] = await Promise.all([listTodos(uid), uid ? ownerBonds() : null]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ todos: data ?? [], ...(bonds ?? {}) }, { headers: { "Cache-Control": "no-store, private" } });
}

async function ownerBonds(): Promise<{ bonds?: unknown[]; bondsLocked?: boolean; bondsError?: string } | null> {
  if (!bondsConfigured()) return null;
  const g = await requireOwner();
  if (g instanceof Response) return g.status === 423 ? { bondsLocked: true } : null;
  const snap = await bondsSnapshot();
  if (!snap) return null;
  return { bonds: snap.tasks, ...(snap.error ? { bondsError: "Bonds unavailable" } : {}) };
}

export async function POST(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;
  const { text } = await req.json();
  const { data, error } = await db.from("todos")
    .insert({ text, done: false, user_id: uid })
    .select("id, text, done, is_public, updated_at").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ todo: data });
}

/** { id, done?, is_public? }. An id of "bonds:<n>" ticks the Bonds vault task instead. */
export async function PATCH(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;
  const { id, done, is_public } = await req.json();
  const bondsId = parseBondsTodoId(id);
  if (bondsId != null) {
    const g = await requireOwner();
    if (g instanceof Response) return g;
    if (typeof done !== "boolean") return Response.json({ error: "done required" }, { status: 400 });
    try {
      await setBondsTaskDone(bondsId, done);
    } catch (e) {
      console.error("todos: bonds tick failed:", e instanceof Error ? e.message : e);
      return Response.json({ error: "bonds_failed" }, { status: 502 });
    }
    return Response.json({ ok: true });
  }
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
