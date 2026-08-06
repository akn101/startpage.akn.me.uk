import { db } from "@/lib/supabase-server";
import { getUid, requireUid } from "@/lib/auth";
import { modules } from "@/lib/config";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const bedrock = new AnthropicBedrock({
  awsAccessKey: process.env.AWS_ACCESS_KEY_ID as string,
  awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  awsRegion:    process.env.AWS_REGION ?? "eu-west-1",
});

// Fetch project names from Notion
async function fetchProjects(): Promise<string[]> {
  const token = process.env.NOTION_TOKEN;
  const db_id = process.env.NOTION_DATABASE_ID_PROJECTS;
  if (!token || !db_id) return [];
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${db_id}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 50 }),
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map((p: { properties: { Name?: { title?: { plain_text: string }[] } } }) =>
      (p.properties.Name?.title ?? []).map((t) => t.plain_text).join("") || ""
    ).filter(Boolean);
  } catch { return []; }
}

// Fetch active assignment subjects from Notion
async function fetchAssignmentSubjects(): Promise<string[]> {
  if (!modules.assignments) return [];
  const token = process.env.NOTION_TOKEN;
  const db_id = process.env.NOTION_DATABASE_ID_ASSIGNMENTS;
  if (!token || !db_id) return [];
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${db_id}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "My Status", status: { equals: "In Progress" } },
        page_size: 20,
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map((p: { properties: { classCode?: { select?: { name?: string } } } }) =>
      p.properties.classCode?.select?.name ?? ""
    ).filter(Boolean);
  } catch { return []; }
}

async function matchProject(label: string): Promise<string | null> {
  try {
    const [projects, subjects] = await Promise.all([fetchProjects(), fetchAssignmentSubjects()]);
    if (!projects.length) return null;

    const context = [
      `Projects: ${projects.join(", ")}`,
      subjects.length ? `Active assignment subjects (these belong to an Eton school project if one exists): ${subjects.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const response = await bedrock.messages.create({
      model: "eu.anthropic.claude-3-haiku-20240307-v1:0",
      max_tokens: 20,
      system: `You match a timer label to the correct project. Reply with ONLY the exact project name from the list, or "null" if nothing fits. No explanation, no punctuation.`,
      messages: [{
        role: "user",
        content: `${context}\n\nTimer label: "${label}"`,
      }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    if (!text || text === "null") return null;
    // Verify the returned name is actually in the projects list
    return projects.find((p) => p.toLowerCase() === text.toLowerCase()) ?? null;
  } catch (e) {
    console.error("Bedrock match error:", e);
    return null;
  }
}

export async function GET() {
  const uid = await getUid();
  let query = db.from("time_sessions")
    .select("id, label, duration_s, project, is_public, started_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (uid) query = query.eq("user_id", uid);
  else query = query.eq("is_public", true);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ sessions: data ?? [] });
}

export async function POST(req: Request) {
  const result = await requireUid();
  if (result instanceof Response) return result;
  const { uid } = result;
  const { label, started_at, ended_at, duration_s } = await req.json();

  const project = await matchProject(label);

  const { data, error } = await db.from("time_sessions")
    .insert({ label, started_at, ended_at, duration_s, user_id: uid, ...(project ? { project } : {}) })
    .select("id, label, duration_s, project, started_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ session: data });
}
