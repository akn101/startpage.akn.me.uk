const env = () => ({
  token: process.env.NOTION_TOKEN ?? "",
  projectsDb: process.env.NOTION_DATABASE_ID_PROJECTS ?? "",
  tasksDb: process.env.NOTION_DATABASE_ID_TASKS ?? "",
});

export function notionFetch(path: string, body?: object) {
  return fetch(`https://api.notion.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env().token}`,
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


/** Shared by GET /api/tasks and GET /api/aknclient/tasks. authed=false hides non-public rows. */
export async function fetchTasksPayload(authed: boolean) {
  const { token, projectsDb: PROJECTS_DB, tasksDb: TASKS_DB } = env();
  if (!token || !PROJECTS_DB || !TASKS_DB) {
    return { projects: [], tasks: [] };
  }

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

  return { projects, tasks };
}

