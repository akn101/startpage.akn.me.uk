import { authorizeAknclient } from "@/lib/aknclient-auth";
import { claim } from "@/lib/mac-music";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET ?wait=20: long-poll; returns {commands:[{id,fn,arg}]} as soon as the TV queues any (claimed). */
export async function GET(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  const raw = Number(new URL(req.url).searchParams.get("wait") ?? 0);
  const wait = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 25) * 1000 : 0;
  const until = Date.now() + wait;
  try {
    for (;;) {
      const commands = await claim();
      if (commands.length || Date.now() >= until || req.signal?.aborted) return Response.json({ commands });
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
