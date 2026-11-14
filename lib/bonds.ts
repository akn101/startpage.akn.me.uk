// Pull from the Bonds vault (prm.akn.me.uk), plus ticking tasks done. Server only.
// Env: BONDS_API_URL = https://prm.akn.me.uk/api/vaults/<vault id>
//      BONDS_API_TOKEN = a Bonds personal access token (never sent to the client)
// Responses are wrapped { success, data }.

export type BondsTask = { id: number; label: string; due_at: string | null; people: string[] };
export type BondsReminder = { id: number; label: string; person: string; contact_id: string; next: string | null; type: string };

export const bondsConfigured = () => !!(process.env.BONDS_API_URL && process.env.BONDS_API_TOKEN);

async function get<T>(path: string): Promise<T | null> {
  const base = process.env.BONDS_API_URL!;
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${process.env.BONDS_API_TOKEN}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`bonds ${path}: ${r.status}`);
  const body = (await r.json()) as { success?: boolean; data?: T };
  return body.data ?? null;
}

async function send(path: string, method: "PATCH" | "POST", body: unknown): Promise<void> {
  const r = await fetch(`${process.env.BONDS_API_URL!}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.BONDS_API_TOKEN}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`bonds ${method} ${path}: ${r.status}`);
}

/** Tick a Bonds vault task done (or reopen it). Throws when Bonds is unset or refuses. */
export async function setBondsTaskDone(id: number, done: boolean): Promise<void> {
  if (!bondsConfigured()) throw new Error("bonds not configured");
  await send(`/tasks/${id}/status`, "PATCH", { status: done ? "done" : "todo" });
}

/** Best contact match for a person's name ("Sakiya Sultana", "SS"), or null. */
export async function findBondsContact(name: string): Promise<{ id: string; name: string } | null> {
  if (!bondsConfigured() || !name.trim()) return null;
  try {
    const r = await get<{ contacts?: { id: string; name?: string; score?: number }[] }>(`/search?q=${encodeURIComponent(name.trim())}&per_page=3`);
    const c = r?.contacts?.[0];
    return c?.id ? { id: c.id, name: c.name ?? name } : null;
  } catch {
    return null;
  }
}

type RawTask = {
  id: number; label: string; completed: boolean; due_at: string | null;
  contacts?: { first_name?: string; last_name?: string; name?: string }[];
};
type RawReminder = {
  id: number; label: string; contact_id: string; contact_first_name?: string; contact_last_name?: string;
  day: number | null; month: number | null; year: number | null; type: string;
};

const personName = (c: { first_name?: string; last_name?: string; name?: string }) =>
  c.name || [c.first_name, c.last_name].filter(Boolean).join(" ");

export function mapTasks(raw: RawTask[] | null): BondsTask[] {
  return (raw ?? [])
    .filter((t) => !t.completed)
    .map((t) => ({ id: t.id, label: t.label, due_at: t.due_at, people: (t.contacts ?? []).map(personName).filter(Boolean) }))
    .sort((a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9"));
}

/** Next occurrence of a reminder's day/month (yearly/one-time) from now, as YYYY-MM-DD. */
export function nextDate(r: Pick<RawReminder, "day" | "month" | "year" | "type">, now = new Date()): string | null {
  if (!r.day || !r.month) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (r.type === "one_time" && r.year) return `${r.year}-${pad(r.month)}-${pad(r.day)}`;
  let y = now.getUTCFullYear();
  const thisYear = Date.UTC(y, r.month - 1, r.day);
  if (thisYear < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) y += 1;
  return `${y}-${pad(r.month)}-${pad(r.day)}`;
}

export function mapReminders(raw: RawReminder[] | null, now = new Date(), withinDays = 30): BondsReminder[] {
  const until = new Date(now.getTime() + withinDays * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  return (raw ?? [])
    .map((r) => ({
      id: r.id, label: r.label, contact_id: r.contact_id, type: r.type,
      person: [r.contact_first_name, r.contact_last_name].filter(Boolean).join(" "),
      next: nextDate(r, now),
    }))
    .filter((r) => r.next && r.next >= today && r.next <= until)
    .sort((a, b) => a.next!.localeCompare(b.next!));
}

export async function bondsSnapshot(): Promise<{ tasks: BondsTask[]; reminders: BondsReminder[]; error?: string } | null> {
  if (!bondsConfigured()) return null;
  try {
    const [tasks, reminders] = await Promise.all([get<RawTask[]>("/tasks"), get<RawReminder[]>("/reminders")]);
    return { tasks: mapTasks(tasks).slice(0, 20), reminders: mapReminders(reminders).slice(0, 20) };
  } catch (e) {
    return { tasks: [], reminders: [], error: e instanceof Error ? e.message.replace(/Bearer\s+\S+/g, "") : "bonds error" };
  }
}
