import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NOTION_TOKEN   = process.env.NOTION_TOKEN!;
const ASSIGNMENTS_DB = process.env.NOTION_DATABASE_ID_ASSIGNMENTS!;

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

function getTitle(props: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const p = props[key] as { title?: { plain_text: string }[] } | undefined;
    const v = (p?.title ?? []).map((t) => t.plain_text).join("");
    if (v) return v;
  }
  return "";
}
function getSelect(props: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const p = props[key] as { select?: { name?: string }; status?: { name?: string } } | undefined;
    const v = p?.select?.name ?? p?.status?.name ?? "";
    if (v) return v;
  }
  return "";
}
function getDate(props: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const p = props[key] as { date?: { start?: string } } | undefined;
    if (p?.date?.start) return p.date.start;
  }
  return null;
}
function getNumber(props: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const p = props[key] as { number?: number } | undefined;
    if (p?.number != null) return p.number;
  }
  return null;
}

export async function GET() {
  if (!NOTION_TOKEN || !ASSIGNMENTS_DB) return Response.json({ assignments: [] });

  const res = await fetch(`https://api.notion.com/v1/databases/${ASSIGNMENTS_DB}/query`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: {
        and: [
          { property: "My Status", status: { does_not_equal: "Archived" } },
          { property: "dueDate", date: { on_or_after: new Date(Date.now() - 90 * 86400000).toISOString() } },
          { property: "dueDate", date: { on_or_before: new Date(Date.now() + 90 * 86400000).toISOString() } },
        ],
      },
      sorts: [{ property: "dueDate", direction: "ascending" }],
    }),
    cache: "no-store",
  });

  if (!res.ok) return Response.json({ assignments: [] });
  const data = await res.json();

  const assignments = (data.results ?? [])
    .map((page: { id: string; url: string; properties: Record<string, unknown> }) => ({
      id: page.id,
      url: page.url,
      title:    getTitle(page.properties, "Title", "Name", "Assignment"),
      status:   getSelect(page.properties, "My Status", "Status"),
      due:      getDate(page.properties, "dueDate", "Due", "Deadline", "Due Date"),
      subject:  getSelect(page.properties, "classCode", "Subject", "Class", "Course"),
      duration: getNumber(page.properties, "Time Estimate", "Duration", "Time (hours)", "Hours"),
    }))
    .filter((a: { status: string }) => !["Complete", "Marked"].includes(a.status));

  return Response.json({ assignments });
}

export async function PATCH(req: Request) {
  if (!isAuthenticated()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!NOTION_TOKEN) return Response.json({ error: "No token" }, { status: 500 });

  const { id, status } = await req.json();
  const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: {
        "My Status": { status: { name: status } },
      },
    }),
    cache: "no-store",
  });
  const data = await res.json();
  return Response.json({ id: data.id });
}
