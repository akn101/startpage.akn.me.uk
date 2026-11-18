import { NO_STORE, requireOwner } from "@/lib/auth";
import { cleanCommand, enqueue, ONLINE_MS, readState } from "@/lib/mac-music";

export const dynamic = "force-dynamic";

/** GET → {online, title, artist, album, playing, position, duration, volume, artwork, updatedAt}. Owner only. */
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  const r = await readState();
  const online = !!r && Date.now() - Date.parse(r.updatedAt) < ONLINE_MS;
  return Response.json(
    { online, running: !!r?.state, ...(r?.state ?? {}), artwork: r?.state ? r.artwork : null, updatedAt: r?.updatedAt ?? null },
    { headers: NO_STORE },
  );
}

/** POST {fn, arg?} → queues a command for aknClient (play [query], pause, resume, next, previous, volume 0-100). */
export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  let body: { fn?: unknown; arg?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE }); }
  const cmd = cleanCommand(body.fn, body.arg);
  if (!cmd) return Response.json({ error: "bad_command" }, { status: 400, headers: NO_STORE });
  const { error } = await enqueue(cmd.fn, cmd.arg);
  if (error) return Response.json({ error: error.message }, { status: 500, headers: NO_STORE });
  return Response.json({ ok: true, queued: cmd }, { headers: NO_STORE });
}
