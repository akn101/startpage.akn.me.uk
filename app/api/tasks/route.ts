import { isAuthenticated, isAdmin } from "@/lib/auth";
import { fetchTasksPayload, notionFetch } from "@/lib/notion-tasks";

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const PROJECTS_DB  = process.env.NOTION_DATABASE_ID_PROJECTS!;
const TASKS_DB     = process.env.NOTION_DATABASE_ID_TASKS!;

export async function GET() {
  return Response.json(await fetchTasksPayload(await isAuthenticated()));
}

export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { type, data } = await req.json();

  if (type === "project") {
    const res = await notionFetch(`/databases/${PROJECTS_DB}`, undefined);
    // Actually create a page in the projects database
    const createRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: PROJECTS_DB },
        properties: {
          Name: { title: [{ text: { content: data.name } }] },
          Status: { select: { name: data.status ?? "Active" } },
          Color: { select: { name: data.color ?? "purple" } },
          is_public: { checkbox: data.is_public ?? false },
          ...(data.category ? { Category: { select: { name: data.category } } } : {}),
        },
      }),
    });
    const created = await createRes.json();
    return Response.json({ id: created.id });
  }

  if (type === "task") {
    const createRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: TASKS_DB },
        properties: {
          Title: { title: [{ text: { content: data.title } }] },
          Status: { select: { name: data.status ?? "Todo" } },
          Priority: { select: { name: data.priority ?? "Medium" } },
          Project: { rich_text: [{ text: { content: data.project ?? "" } }] },
          is_public: { checkbox: data.is_public ?? false },
          ...(data.deadline ? { Deadline: { date: { start: data.deadline } } } : {}),
        },
      }),
    });
    const created = await createRes.json();
    return Response.json({ id: created.id });
  }

  return Response.json({ error: "Unknown type" }, { status: 400 });
}

export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, properties } = await req.json();
  const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
    cache: "no-store",
  });
  const data = await res.json();
  return Response.json({ id: data.id });
}
