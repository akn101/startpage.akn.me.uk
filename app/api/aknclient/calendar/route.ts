import { authorizeAknclient } from "@/lib/aknclient-auth";
import { fetchCalendarPayload } from "@/lib/caldav";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  const raw = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const days = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 31) : 7;
  const { status, body } = await fetchCalendarPayload({ days, limit: 100 });
  return Response.json(body, { status });
}
