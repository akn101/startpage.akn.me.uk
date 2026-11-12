import { db } from "@/lib/supabase-server";
import { requireSensitive, NO_STORE } from "@/lib/auth";
import { bondsSnapshot } from "@/lib/bonds";
import { parseWhen } from "@/lib/when";

export const dynamic = "force-dynamic";

const KINDS = ["wish", "thought", "reminder"] as const;
type Kind = (typeof KINDS)[number];
const COLS = "id, kind, text, person, bonds_contact_id, due_at, done, created_at";
const bad = (error: string, status = 400) => Response.json({ error }, { status, headers: NO_STORE });

/** Everything on your mind: your own items + live Bonds tasks/reminders. PIN-gated. */
export async function GET() {
  const g = await requireSensitive();
  if (g instanceof Response) return g;
  const [{ data, error }, bonds] = await Promise.all([
    db.from("mind_items").select(COLS).eq("user_id", g.uid).eq("done", false).order("created_at", { ascending: false }),
    bondsSnapshot(),
  ]);
  if (error) return bad(error.message, 500);
  return Response.json({ items: data ?? [], bonds }, { headers: NO_STORE });
}

/**
 * Add an item. { kind, text, person?, when? }
 * For reminders, a date phrase in the text ("journal tomorrow") sets due_at.
 */
export async function POST(req: Request) {
  const g = await requireSensitive();
  if (g instanceof Response) return g;
  const b = await req.json().catch(() => ({}));
  const kind = b.kind as Kind;
  if (!KINDS.includes(kind)) return bad("bad kind");
  let text = typeof b.text === "string" ? b.text.trim() : "";
  const person = typeof b.person === "string" && b.person.trim() ? b.person.trim().slice(0, 200) : null;
  let due_at: string | null = null;
  if (kind === "reminder") {
    const p = parseWhen(text);
    if (p.due) { text = p.text; due_at = p.due.toISOString(); }
  }
  if (!text || text.length > 2000) return bad("text required (≤2000 chars)");
  const { data, error } = await db.from("mind_items")
    .insert({ user_id: g.uid, kind, text, person, due_at, done: false, bonds_contact_id: b.bonds_contact_id ?? null })
    .select(COLS).single();
  if (error) return bad(error.message, 500);
  return Response.json({ item: data }, { headers: NO_STORE });
}

/** { id, done?, text?, person? } */
export async function PATCH(req: Request) {
  const g = await requireSensitive();
  if (g instanceof Response) return g;
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string") return bad("id required");
  const u: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.done === "boolean") u.done = b.done;
  if (typeof b.text === "string" && b.text.trim()) u.text = b.text.trim().slice(0, 2000);
  if (b.person === null || typeof b.person === "string") u.person = b.person?.trim() || null;
  const { error } = await db.from("mind_items").update(u).eq("id", b.id).eq("user_id", g.uid);
  if (error) return bad(error.message, 500);
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(req: Request) {
  const g = await requireSensitive();
  if (g instanceof Response) return g;
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string") return bad("id required");
  const { error } = await db.from("mind_items").delete().eq("id", b.id).eq("user_id", g.uid);
  if (error) return bad(error.message, 500);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
