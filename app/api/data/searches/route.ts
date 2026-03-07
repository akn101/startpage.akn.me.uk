import { db } from "@/lib/supabase-server";
import { isAuthenticated, requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAuthenticated()) return Response.json({ searches: [] });
  const { data } = await db
    .from("searches")
    .select("query, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  return Response.json({ searches: data ?? [] });
}

export async function POST(req: Request) {
  const deny = requireAuth();
  if (deny) return deny;
  const { query } = await req.json();
  if (!query?.trim()) return Response.json({ ok: false });
  await db.from("searches").insert({ query: query.trim() });
  return Response.json({ ok: true });
}
