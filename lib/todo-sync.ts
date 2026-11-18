// One todo list from two sources: startpage todos (Supabase) and Bonds vault
// tasks. Pure; used by the TV and the startpage Todos widget.

export type LocalTodo = { id: string; text: string; done: boolean; updated_at?: string | null };
export type BondsTodo = { id: number; label: string; due_at: string | null; people: string[] };
export type SyncedTodo = {
  id: string;                 // startpage uuid, or "bonds:<id>"
  text: string;
  done: boolean;
  source: "startpage" | "bonds";
  due_at: string | null;
  people: string[];
};

/** Ticked items stay visible this long, then drop off the list. */
export const DONE_LINGER_MS = 10 * 60_000;

export const bondsTodoId = (id: number) => `bonds:${id}`;
export const parseBondsTodoId = (id: unknown): number | null => {
  const m = typeof id === "string" ? id.match(/^bonds:(\d+)$/) : null;
  return m ? Number(m[1]) : null;
};

/**
 * Open items first (startpage in its own order, then Bonds by due date), then
 * items ticked within the last `lingerMs`. `doneAt` holds local tick times
 * (ms) for items ticked on this screen, which win over the server timestamp.
 */
export function mergeTodos(
  local: LocalTodo[],
  bonds: BondsTodo[] | null | undefined,
  opts: { now?: number; lingerMs?: number; doneAt?: Record<string, number>; doneIds?: Set<string> } = {},
): SyncedTodo[] {
  const now = opts.now ?? Date.now();
  const linger = opts.lingerMs ?? DONE_LINGER_MS;
  const doneAt = opts.doneAt ?? {};
  const fresh = (id: string, serverAt?: string | null) => {
    const at = doneAt[id] ?? (serverAt ? Date.parse(serverAt) : NaN);
    return Number.isFinite(at) && now - at < linger;
  };
  const a: SyncedTodo[] = local.map((t) => ({ id: t.id, text: t.text, done: t.done, source: "startpage", due_at: null, people: [] }));
  const b: SyncedTodo[] = [...(bonds ?? [])]
    .sort((x, y) => (x.due_at ?? "9").localeCompare(y.due_at ?? "9"))
    .map((t) => {
      const id = bondsTodoId(t.id);
      return { id, text: t.label, done: !!opts.doneIds?.has(id), source: "bonds", due_at: t.due_at, people: t.people };
    });
  const stamp = new Map(local.map((t) => [t.id, t.updated_at]));
  const open = [...a, ...b].filter((t) => !t.done);
  const done = [...a, ...b].filter((t) => t.done && fresh(t.id, stamp.get(t.id)));
  return [...open, ...done];
}
