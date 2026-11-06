import { authorizeAknclient } from "@/lib/aknclient-auth";
import { fetchTasksPayload } from "@/lib/notion-tasks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = authorizeAknclient(req);
  if (denied) return denied;
  // Service key = owner access, so private rows are included.
  return Response.json(await fetchTasksPayload(true));
}
