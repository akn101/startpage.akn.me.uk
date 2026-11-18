import { NO_STORE } from "@/lib/auth";
import { random } from "@/lib/subsonic";
import { subsonicRoute } from "@/lib/subsonic-route";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** GET → 20 random tracks. Owner profile only. */
export async function GET() {
  return subsonicRoute("random", async () => Response.json(await random(20), { headers: NO_STORE }));
}
