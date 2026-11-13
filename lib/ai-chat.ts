// Aria, the spoken assistant on the TV: short, plain-text answers (read aloud by TTS),
// grounded in today's brief data. Same Bedrock client/model as the morning brief.
import { bedrockClient, bedrockModel, gatherBrief, londonTime } from "./brief";
import { tvModules } from "./tv-config";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AriaAction =
  | { type: "music.play"; query: string }
  | { type: "music.pause" }
  | { type: "music.resume" }
  | { type: "music.next" }
  | { type: "open"; module: string };

export const MAX_HISTORY = 12;
export const MAX_CONTENT = 2000;

const SYSTEM = `You are Aria, a concise, warm assistant on the owner's TV. Your answers are spoken
aloud by text-to-speech, so keep them short: two to four sentences, plain text, no markdown,
no bullet points, no lists, no emoji, no URLs. Times are Europe/London; say them naturally.
For questions about today (calendar, todos, reminders, people) use only the context below and
never invent events or tasks; if it isn't there, say so. For general questions, answer briefly.
You can control Apple Music on the TV and open dashboard modules with the tools. When asked to
play, pause, resume or skip music, or to show a module, call the tool AND reply with a short
spoken confirmation (for example "Playing Kind of Blue."). Never mention the tools by name.`;

const MAX_ACTIONS = 4;

function tools(modules: string[]) {
  return [
    {
      name: "music_play",
      description: "Search Apple Music and start playing a song, album, artist or playlist on the TV.",
      input_schema: { type: "object" as const, properties: { query: { type: "string", description: "What to play, e.g. 'Kind of Blue album' or 'my chill playlist'." } }, required: ["query"] },
    },
    { name: "music_pause", description: "Pause music on the TV.", input_schema: { type: "object" as const, properties: {} } },
    { name: "music_resume", description: "Resume paused music on the TV.", input_schema: { type: "object" as const, properties: {} } },
    { name: "music_next", description: "Skip to the next track.", input_schema: { type: "object" as const, properties: {} } },
    {
      name: "open_module",
      description: "Show a dashboard module on the TV.",
      input_schema: { type: "object" as const, properties: { module: { type: "string", enum: modules } }, required: ["module"] },
    },
  ];
}

/** Map a tool call to an action the TV app understands; null if malformed. */
export function toAction(name: string, input: unknown, modules: string[]): AriaAction | null {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "music_play": {
      const q = typeof i.query === "string" ? i.query.trim().slice(0, 200) : "";
      return q ? { type: "music.play", query: q } : null;
    }
    case "music_pause": return { type: "music.pause" };
    case "music_resume": return { type: "music.resume" };
    case "music_next": return { type: "music.next" };
    case "open_module": return typeof i.module === "string" && modules.includes(i.module) ? { type: "open", module: i.module } : null;
    default: return null;
  }
}

const confirm = (a: AriaAction) =>
  a.type === "music.play" ? `Playing ${a.query}.` :
  a.type === "music.pause" ? "Paused." :
  a.type === "music.resume" ? "Resuming." :
  a.type === "music.next" ? "Skipping." : `Opening ${a.module}.`;

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

export async function chat(uid: string, messages: ChatMessage[]): Promise<{ text: string; actions: AriaAction[]; ai: boolean }> {
  const bedrock = bedrockClient();
  if (!bedrock) return { text: "Sorry, I'm not set up yet.", actions: [], ai: false };
  const modules = tvModules().owner;
  const b = await gatherBrief(uid).catch(() => null);
  const context = b
    ? `Now: ${londonTime(b.now)}\nContext (today's data):\n${JSON.stringify({ events: b.events, todos: b.todos, reminders: b.reminders, bonds: b.bonds, wishes: b.wishes })}`
    : `Now: ${londonTime(new Date().toISOString())}\n(Today's data is unavailable right now.)`;
  try {
    const r = await bedrock.messages.create({
      model: bedrockModel(),
      max_tokens: 300,
      system: `${SYSTEM}\n\n${context}`,
      tools: tools(modules),
      messages,
    });
    const actions: AriaAction[] = [];
    let text = "";
    for (const c of r.content) {
      if (c.type === "text") text += c.text;
      else if (c.type === "tool_use" && actions.length < MAX_ACTIONS) {
        const a = toAction(c.name, c.input, modules);
        if (a) actions.push(a);
      }
    }
    text = plain(text);
    if (!text && actions.length) text = actions.map(confirm).join(" ");
    return text ? { text, actions, ai: true } : { text: "Sorry, I didn't catch that.", actions: [], ai: false };
  } catch (e) {
    console.error("ai/chat: bedrock failed:", e instanceof Error ? e.message : e);
    return { text: "Sorry, I can't answer right now.", actions: [], ai: false };
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
