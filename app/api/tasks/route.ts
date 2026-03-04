import { isAuthenticated } from "@/lib/auth";

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const PROJECTS_DB  = process.env.NOTION_DATABASE_ID_PROJECTS!;
const TASKS_DB     = process.env.NOTION_DATABASE_ID_TASKS!;

function notionFetch(path: string, body?: object) {
  return fetch(`https://api.notion.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    next: { revalidate: 60 },
  });
}

function getTitle(properties: Record<string, unknown>, key: string): string {
  const prop = (properties[key] as { title?: { plain_text: string }[] }) ?? {};
  return (prop.title ?? []).map((t) => t.plain_text).join("") || "";
}

function getSelect(properties: Record<string, unknown>, key: string): string {
  const prop = properties[key] as { select?: { name?: string } } | undefined;
  return prop?.select?.name ?? "";
}

function getCheckbox(properties: Record<string, unknown>, key: string): boolean {
  const prop = properties[key] as { checkbox?: boolean } | undefined;
  return prop?.checkbox ?? false;
}

function getDate(properties: Record<string, unknown>, key: string): string | null {
  const prop = properties[key] as { date?: { start?: string } } | undefined;
  return prop?.date?.start ?? null;
}

function getRichText(properties: Record<string, unknown>, key: string): string {
  const prop = properties[key] as { rich_text?: { plain_text: string }[] } | undefined;
  return (prop?.rich_text ?? []).map((t) => t.plain_text).join("");
}

export async function GET() {
  if (!NOTION_TOKEN || !PROJECTS_DB || !TASKS_DB) {
    return Response.json({ projects: [], tasks: [] });
  }

  const authed = isAuthenticated();

  const [projRes, taskRes] = await Promise.all([
    notionFetch(`/databases/${PROJECTS_DB}/query`, {
      filter: { property: "Status", select: { does_not_equal: "Done" } },
      sorts: [{ property: "Status", direction: "ascending" }],
    }),
    notionFetch(`/databases/${TASKS_DB}/query`, {
      filter: { property: "Status", select: { does_not_equal: "Done" } },
      sorts: [{ property: "Priority", direction: "ascending" }],
    }),
  ]);

  const projData = await projRes.json();
  const taskData = await taskRes.json();

  const allProjects = (projData.results ?? []).map((p: { id: string; url: string; properties: Record<string, unknown> }) => ({
    id: p.id,
    name: getTitle(p.properties, "Name"),
    status: getSelect(p.properties, "Status"),
    color: getSelect(p.properties, "Color"),
    category: getSelect(p.properties, "Category"),
    keywords: getRichText(p.properties, "Keywords"),
    is_public: getCheckbox(p.properties, "is_public"),
    url: p.url,
  }));

  const allTasks = (taskData.results ?? []).map((t: { id: string; url: string; properties: Record<string, unknown> }) => ({
    id: t.id,
    title: getTitle(t.properties, "Title"),
    project: getRichText(t.properties, "Project"),
    priority: getSelect(t.properties, "Priority"),
    status: getSelect(t.properties, "Status"),
    deadline: getDate(t.properties, "Deadline"),
    is_public: getCheckbox(t.properties, "is_public"),
    url: t.url,
  }));

  // Filter by public/private
  const projects = authed ? allProjects : allProjects.filter((p: { is_public: boolean }) => p.is_public);
  const tasks    = authed ? allTasks    : allTasks.filter((t: { is_public: boolean }) => t.is_public);

  return Response.json({ projects, tasks });
}

export async function POST(req: Request) {
  const authed = isAuthenticated();
  if (!authed) return Response.json({ error: "Unauthorized" }, { status: 401 });

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
