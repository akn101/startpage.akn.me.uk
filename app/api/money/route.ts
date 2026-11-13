import { requireSensitive, NO_STORE } from "@/lib/auth";
import { moneySnapshot, MoneyNotConfigured } from "@/lib/money";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Lunch Money snapshot (balances, net worth, this month, recent). PIN-gated on the TV. */
export async function GET() {
  const g = await requireSensitive();
  if (g instanceof Response) return g;
  try {
    return Response.json(await moneySnapshot(), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof MoneyNotConfigured) {
      return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
    }
    console.error("money:", e instanceof Error ? e.message : e);
    return Response.json({ error: "upstream_failed" }, { status: 502, headers: NO_STORE });
  }
}
