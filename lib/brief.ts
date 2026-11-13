// Morning brief: gathers today's calendar, todos, Mind items and Bonds, then
// asks Claude (via the existing Bedrock credentials) for a short summary.
// Falls back to a plain list when Bedrock is unavailable.
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { db } from "./supabase-server";
import { listTodos } from "./todos";
import { bondsSnapshot } from "./bonds";
import { fetchCalendarPayload } from "./caldav";

export type BriefInput = {
  now: string;
  events: { title?: string; summary?: string; start: string }[];
  todos: string[];
  reminders: { text: string; due_at: string | null }[];
  wishes: { person: string | null; text: string }[];
  thoughts: string[];
  bonds: { tasks: string[]; reminders: string[] } | null;
};

const ln = (d: string) =>
  new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export async function gatherBrief(uid: string, now = new Date()): Promise<BriefInput> {
  const soon = new Date(now.getTime() + 36 * 3600_000).toISOString();
  const [todos, mind, bonds, cal] = await Promise.all([
    listTodos(uid),
    db.from("mind_items").select("kind, text, person, due_at").eq("user_id", uid).eq("done", false),
    bondsSnapshot(),
    fetchCalendarPayload({ days: 2, limit: 15 }).catch(() => ({ body: { events: [] } })),
  ]);
  const items = (mind.data ?? []) as { kind: string; text: string; person: string | null; due_at: string | null }[];
  return {
    now: now.toISOString(),
    events: ((cal.body.events ?? []) as BriefInput["events"]).slice(0, 15),
    todos: ((todos.data ?? []) as { text: string; done: boolean }[]).filter((t) => !t.done).map((t) => t.text).slice(0, 25),
    reminders: items.filter((i) => i.kind === "reminder" && (!i.due_at || i.due_at <= soon)).map(({ text, due_at }) => ({ text, due_at })),
    wishes: items.filter((i) => i.kind === "wish").map(({ person, text }) => ({ person, text })),
    thoughts: items.filter((i) => i.kind === "thought").map((i) => i.text).slice(0, 10),
    bonds: bonds && {
      tasks: bonds.tasks.map((t) => t.label + (t.people.length ? ` (${t.people.join(", ")})` : "")),
      reminders: bonds.reminders.map((r) => `${r.person}: ${r.label} on ${r.next}`),
    },
  };
}

/** Plain, non-AI brief. Also the fallback. */
export function plainBrief(b: BriefInput): string {
  const out: string[] = [];
  if (b.events.length) out.push("Today:\n" + b.events.map((e) => `• ${ln(e.start)} — ${e.title ?? e.summary ?? "event"}`).join("\n"));
  if (b.reminders.length) out.push("Reminders:\n" + b.reminders.map((r) => `• ${r.text}${r.due_at ? ` (${ln(r.due_at)})` : ""}`).join("\n"));
  if (b.todos.length) out.push("Todos:\n" + b.todos.map((t) => `• ${t}`).join("\n"));
  if (b.bonds?.reminders.length) out.push("People:\n" + b.bonds.reminders.map((r) => `• ${r}`).join("\n"));
  if (b.wishes.length) out.push("Remember:\n" + b.wishes.map((w) => `• ${w.person ? `${w.person} wants you to ` : ""}${w.text}`).join("\n"));
  return out.join("\n\n") || "Nothing on today. Enjoy it.";
}

const SYSTEM = `You write a short, warm morning brief for one person, read on their startpage.
Use only the data given; never invent events or tasks. Times are Europe/London.
Shape: one opening line; "Today" (calendar + reminders due, in time order);
"Top 3" (the most important todos/tasks); one closing line that weaves in at most one
of the "wishes" (what people close to them want for them) gently, in second person.
Plain text with short bullet lines (•). Under 160 words. No preamble, no sign-off.`;

/** Shared Bedrock client (null when AWS credentials are missing). Also used by /api/ai/chat. */
export function bedrockClient(): AnthropicBedrock | null {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;
  return new AnthropicBedrock({
    awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
    awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
    awsRegion: process.env.AWS_REGION ?? "eu-west-1",
  });
}
export const bedrockModel = () => process.env.BRIEF_MODEL ?? "eu.anthropic.claude-3-haiku-20240307-v1:0";
export const londonTime = ln;

export async function aiBrief(b: BriefInput): Promise<{ text: string; ai: boolean }> {
  const bedrock = bedrockClient();
  if (!bedrock) return { text: plainBrief(b), ai: false };
  try {
    const r = await bedrock.messages.create({
      model: bedrockModel(),
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: `Now: ${ln(b.now)}\n\n${JSON.stringify(b)}` }],
    });
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    return text ? { text, ai: true } : { text: plainBrief(b), ai: false };
  } catch (e) {
    console.error("brief: bedrock failed:", e instanceof Error ? e.message : e);
    return { text: plainBrief(b), ai: false };
  }
}
