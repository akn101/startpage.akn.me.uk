import { db } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/auth";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const bedrock = new AnthropicBedrock({
  awsAccessKey: process.env.AWS_ACCESS_KEY_ID as string,
  awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  awsRegion:    process.env.AWS_REGION ?? "eu-west-1",
});

async function fetchProjects(): Promise<{ id: string; name: string }[]> {
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
      body: JSON.stringify({
        filter: { property: "Status", select: { does_not_equal: "Done" } },
        page_size: 50,
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map((p: { id: string; properties: { Name?: { title?: { plain_text: string }[] } } }) => ({
      id: p.id,
      name: (p.properties.Name?.title ?? []).map((t) => t.plain_text).join("") || "",
    })).filter((p: { id: string; name: string }) => p.name);
  } catch { return []; }
}

interface Suggestion {
  todoId: string;
  todoText: string;
  project: string | null;
}

async function matchTodosToProjects(
  todos: { id: string; text: string }[],
  projects: { id: string; name: string }[]
): Promise<Suggestion[]> {
  if (!projects.length || !todos.length) {
    return todos.map((t) => ({ todoId: t.id, todoText: t.text, project: null }));
  }

  const projectNames = projects.map((p) => p.name);
  const todoList = todos.map((t, i) => `${i + 1}. ${t.text}`).join("\n");

  try {
    const response = await bedrock.messages.create({
      model: "eu.anthropic.claude-3-haiku-20240307-v1:0",
      max_tokens: 500,
      system: `You match a list of todos to projects. Return ONLY a valid JSON array with no extra text, in the format: [{"index": 1, "project": "exact project name or null"}, ...]. Use null if no project fits.`,
      messages: [{
        role: "user",
        content: `Projects: ${projectNames.join(", ")}\n\nTodos:\n${todoList}`,
      }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "[]";
    const parsed: { index: number; project: string | null }[] = JSON.parse(text);

    return todos.map((todo, i) => {
      const match = parsed.find((p) => p.index === i + 1);
      const projectName = match?.project ?? null;
      // Verify the returned name is actually in the projects list
      const verified = projectName
        ? (projectNames.find((p) => p.toLowerCase() === projectName.toLowerCase()) ?? null)
        : null;
      return { todoId: todo.id, todoText: todo.text, project: verified };
    });
  } catch (e) {
    console.error("Bedrock migrate error:", e);
    return todos.map((t) => ({ todoId: t.id, todoText: t.text, project: null }));
  }
}

async function createNotionTask(title: string, projectName: string) {
  const token = process.env.NOTION_TOKEN;
  const tasksDb = process.env.NOTION_DATABASE_ID_TASKS;
  if (!token || !tasksDb) return;
  await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: tasksDb },
      properties: {
        Title: { title: [{ text: { content: title } }] },
        Status: { select: { name: "Todo" } },
        Priority: { select: { name: "Medium" } },
        Project: { rich_text: [{ text: { content: projectName } }] },
        is_public: { checkbox: false },
      },
    }),
  });
}

// POST /api/data/todos/migrate
// Body: { analyze: true } → returns suggestions
// Body: { confirm: true, suggestions: Suggestion[] } → creates tasks, deletes todos
export async function POST(req: Request) {
  const deny = requireAuth();
  if (deny) return deny;

  const body = await req.json();

  if (body.analyze) {
    const { data: todosData, error } = await db
      .from("todos")
      .select("id, text")
      .eq("done", false);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!todosData?.length) return Response.json({ suggestions: [] });

    const projects = await fetchProjects();
    const suggestions = await matchTodosToProjects(todosData, projects);
    return Response.json({ suggestions });
  }

  if (body.confirm) {
    const suggestions: Suggestion[] = body.suggestions ?? [];
    const matched = suggestions.filter((s) => s.project !== null);
    if (!matched.length) return Response.json({ moved: 0 });

    // Create Notion tasks
    await Promise.all(matched.map((s) => createNotionTask(s.todoText, s.project!)));

    // Delete the migrated todos from Supabase
    const ids = matched.map((s) => s.todoId);
    await db.from("todos").delete().in("id", ids);

    return Response.json({ moved: matched.length });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
