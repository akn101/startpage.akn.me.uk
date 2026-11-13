// Spoken assistant for the TV: short, plain-text answers (read aloud by TTS),
// grounded in today's brief data. Same Bedrock client/model as the morning brief.
import { bedrockClient, bedrockModel, gatherBrief, londonTime } from "./brief";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export const MAX_HISTORY = 12;
export const MAX_CONTENT = 2000;

const SYSTEM = `You are a concise, warm assistant on the owner's TV. Your answers are spoken
aloud by text-to-speech, so keep them short: two to four sentences, plain text, no markdown,
no bullet points, no lists, no emoji, no URLs. Times are Europe/London; say them naturally.
For questions about today (calendar, todos, reminders, people) use only the context below and
never invent events or tasks; if it isn't there, say so. For general questions, answer briefly.`;

/** Validate and trim the client's history. Returns null if unusable. */
export function cleanMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  const msgs: ChatMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim().slice(0, MAX_CONTENT);
    if (text) msgs.push({ role, content: text });
  }
  let out = msgs.slice(-MAX_HISTORY);
  // The model needs a user turn first and last; merge consecutive same-role turns.
  while (out.length && out[0].role !== "user") out = out.slice(1);
  const merged: ChatMessage[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  if (!merged.length || merged[merged.length - 1].role !== "user") return null;
  return merged;
}

export async function chat(uid: string, messages: ChatMessage[]): Promise<{ text: string; ai: boolean }> {
  const bedrock = bedrockClient();
  if (!bedrock) return { text: "Sorry, the assistant isn't set up yet.", ai: false };
  const b = await gatherBrief(uid).catch(() => null);
  const context = b
    ? `Now: ${londonTime(b.now)}\nContext (today's data):\n${JSON.stringify({ events: b.events, todos: b.todos, reminders: b.reminders, bonds: b.bonds, wishes: b.wishes })}`
    : `Now: ${londonTime(new Date().toISOString())}\n(Today's data is unavailable right now.)`;
  try {
    const r = await bedrock.messages.create({
      model: bedrockModel(),
      max_tokens: 300,
      system: `${SYSTEM}\n\n${context}`,
      messages,
    });
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    return text ? { text: plain(text), ai: true } : { text: "Sorry, I didn't catch that.", ai: false };
  } catch (e) {
    console.error("ai/chat: bedrock failed:", e instanceof Error ? e.message : e);
    return { text: "Sorry, I can't answer right now.", ai: false };
  }
}

/** Strip any markdown the model slips in; TTS reads symbols aloud. */
export const plain = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*|__|`|#+ /g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
