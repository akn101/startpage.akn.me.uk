import { db } from "@/lib/supabase-server";
import { isAuthenticated, requireAuth } from "@/lib/auth";

export async function GET() {
  const authed = isAuthenticated();
  let query = db.from("time_sessions")
    .select("id, label, duration_s, project, is_public, started_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!authed) query = query.eq("is_public", true);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ sessions: data ?? [] });
}

export async function POST(req: Request) {
  const deny = requireAuth();
  if (deny) return deny;
  const { label, started_at, ended_at, duration_s, project } = await req.json();
  const { data, error } = await db.from("time_sessions")
    .insert({ label, started_at, ended_at, duration_s, ...(project ? { project } : {}) })
    .select("id, label, duration_s, project")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ session: data });
}
