import { db } from "@/lib/supabase-server";
import { getUid, requireUid } from "@/lib/auth";

// Days of history returned — enough to draw a week strip and walk back a
// streak without pulling the whole table.
const WINDOW_DAYS = 90;

function windowStart(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

// Streaks are computed client-side from these days, where the browser's local
// date is known. The server never guesses what "today" means.
export async function GET() {
  const uid = await getUid();
  if (!uid) return Response.json({ habits: [] });

  const { data: habits, error } = await db
    .from("habits")
    .select("id, name, sort")
    .eq("user_id", uid)
    .eq("active", true)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const ids = (habits ?? []).map((h) => h.id);
  if (ids.length === 0) return Response.json({ habits: [] });

  const { data: logs, error: logErr } = await db
    .from("habit_logs")
    .select("habit_id, day")
    .in("habit_id", ids)
    .gte("day", windowStart());
  if (logErr) return Response.json({ error: logErr.message }, { status: 500 });

  const byHabit: Record<string, string[]> = {};
  for (const l of logs ?? []) {
    (byHabit[l.habit_id] ??= []).push(l.day as string);
  }

  return Response.json({
    habits: (habits ?? []).map((h) => ({
      ...h,
      days: (byHabit[h.id] ?? []).sort().reverse(),
    })),
  });
}

export async function POST(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;

  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("habits")
    .insert({ name: name.trim(), user_id: uid })
    .select("id, name, sort")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ habit: { ...data, days: [] } });
}

// Mark or unmark a habit for a given calendar day (client sends its local date)
export async function PATCH(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;

  const { id, day, done } = await req.json();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) {
    return Response.json({ error: "id and day (YYYY-MM-DD) required" }, { status: 400 });
  }

  // Confirm the habit belongs to this user before touching its logs
  const { data: owned } = await db
    .from("habits").select("id").eq("id", id).eq("user_id", uid).maybeSingle();
  if (!owned) return Response.json({ error: "Not found" }, { status: 404 });

  if (done) {
    const { error } = await db
      .from("habit_logs")
      .upsert({ habit_id: id, day, user_id: uid }, { onConflict: "habit_id,day" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await db
      .from("habit_logs").delete().eq("habit_id", id).eq("day", day);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;

  const { id } = await req.json();
  const { error } = await db.from("habits").delete().eq("id", id).eq("user_id", uid);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
