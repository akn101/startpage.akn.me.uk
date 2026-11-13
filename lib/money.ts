// Lunch Money snapshot for the TV / startpage: balances, net worth, this
// month's spend and income, and the latest transactions. Lunch Money v1 REST
// API (https://dev.lunchmoney.app/v1), bearer token from LUNCHMONEY_TOKEN.
// Field names checked against the live v1 responses (2026-11-13).
//
// Amount conventions in Lunch Money v1: a positive transaction amount is a
// debit (money out); `to_base` is the amount in the user's primary currency.
// In the snapshot we flip to the natural sign: spending negative, income positive.

const BASE = "https://dev.lunchmoney.app/v1";
const TTL_MS = 5 * 60_000;
const RECENT = 8;
const TOP_CATEGORIES = 5;

export type MoneySnapshot = {
  accounts: { name: string; balance: number; currency: string; type: string }[];
  netWorth: { amount: number; currency: string };
  month: { spent: number; income: number; currency: string; topCategories: { name: string; amount: number }[] };
  recent: { date: string; payee: string; amount: number; currency: string; category: string }[];
  at: string;
};

type LmAsset = {
  id: number; type_name: string; name: string; display_name: string | null;
  balance: string; to_base: number; currency: string; closed_on: string | null;
};
type LmPlaid = {
  id: number; type: string; name: string; display_name: string | null;
  balance: string; to_base: number; currency: string; status: string;
};
type LmCategory = { id: number; name: string; is_group: boolean; group_id: number | null };
type LmTx = {
  id: number; date: string; payee: string | null; amount: string; currency: string; to_base: number;
  category_id: number | null; category_name: string | null; category_group_name?: string | null;
  is_income: boolean; exclude_from_totals: boolean; has_children: boolean;
  is_group: boolean; group_id: number | null;
};

export class MoneyNotConfigured extends Error {}

const LIABILITY = new Set(["credit", "loan", "other liability"]);
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v)) || 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function lm<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`lunchmoney ${path.split("?")[0]}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Pure: build the snapshot from raw v1 responses. Exported for tests. */
export function buildSnapshot(
  raw: { primaryCurrency: string; assets: LmAsset[]; plaid: LmPlaid[]; categories: LmCategory[]; transactions: LmTx[] },
  now = new Date(),
): MoneySnapshot {
  const currency = (raw.primaryCurrency || "gbp").toUpperCase();
  const accounts: (MoneySnapshot["accounts"][number] & { base: number })[] = [];
  for (const a of raw.assets) {
    if (a.closed_on) continue;
    accounts.push({ name: a.display_name || a.name, balance: r2(num(a.balance)), currency: a.currency.toUpperCase(), type: a.type_name, base: num(a.to_base) });
  }
  for (const a of raw.plaid) {
    if (a.status === "inactive" || a.status === "closed") continue;
    accounts.push({ name: a.display_name || a.name, balance: r2(num(a.balance)), currency: a.currency.toUpperCase(), type: a.type, base: num(a.to_base) });
  }
  const netWorth = accounts.reduce((s, a) => s + (LIABILITY.has(a.type) ? -a.base : a.base), 0);

  const cats = new Map(raw.categories.map((c) => [c.id, c]));
  const catName = (t: LmTx) => {
    const c = t.category_id != null ? cats.get(t.category_id) : undefined;
    return c?.name ?? t.category_name ?? "Uncategorised";
  };
  const groupName = (t: LmTx) => {
    const c = t.category_id != null ? cats.get(t.category_id) : undefined;
    const g = c?.group_id != null ? cats.get(c.group_id) : undefined;
    return g?.name ?? t.category_group_name ?? catName(t);
  };

  // Split parents are represented by their children; group members by their group row.
  const groupIds = new Set(raw.transactions.filter((t) => t.is_group).map((t) => t.id));
  const txs = raw.transactions.filter((t) => !t.has_children && !(t.group_id != null && groupIds.has(t.group_id)));

  const monthStart = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  let spent = 0, income = 0;
  const byCat = new Map<string, number>();
  for (const t of txs) {
    if (t.date < monthStart || t.exclude_from_totals) continue;
    const base = num(t.to_base);
    if (t.is_income) income -= base; // income is a credit, i.e. negative in v1
    else {
      spent += base; // refunds (negative) reduce spend
      const name = groupName(t);
      byCat.set(name, (byCat.get(name) ?? 0) + base);
    }
  }
  const topCategories = [...byCat.entries()]
    .filter(([, v]) => v > 0.005)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CATEGORIES)
    .map(([name, amount]) => ({ name, amount: r2(amount) }));

  const recent = [...txs]
    .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
    .slice(0, RECENT)
    .map((t) => ({
      date: t.date,
      payee: t.payee || "Unknown",
      amount: r2(-num(t.amount)),
      currency: t.currency.toUpperCase(),
      category: catName(t),
    }));

  return {
    accounts: accounts.map(({ base: _base, ...a }) => a),
    netWorth: { amount: r2(netWorth), currency },
    month: { spent: r2(spent), income: r2(income), currency, topCategories },
    recent,
    at: now.toISOString(),
  };
}

let cache: { at: number; data: MoneySnapshot } | null = null;
let inflight: Promise<MoneySnapshot> | null = null;

/** Cached ~5 min in-process. Throws MoneyNotConfigured without a token. */
export async function moneySnapshot(): Promise<MoneySnapshot> {
  const token = process.env.LUNCHMONEY_TOKEN;
  if (!token) throw new MoneyNotConfigured();
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // Reach back at least two weeks so "recent" isn't empty on the 1st.
    const from = new Date(Math.min(monthStart.getTime(), now.getTime() - 14 * 86400_000));
    const [me, assets, plaid, categories, tx] = await Promise.all([
      lm<{ primary_currency: string }>("/me", token),
      lm<{ assets: LmAsset[] }>("/assets", token),
      lm<{ plaid_accounts: LmPlaid[] }>("/plaid_accounts", token),
      lm<{ categories: LmCategory[] }>("/categories", token),
      lm<{ transactions: LmTx[] }>(`/transactions?start_date=${iso(from)}&end_date=${iso(now)}&limit=1000`, token),
    ]);
    const data = buildSnapshot(
      {
        primaryCurrency: me.primary_currency,
        assets: assets.assets ?? [],
        plaid: plaid.plaid_accounts ?? [],
        categories: categories.categories ?? [],
        transactions: tx.transactions ?? [],
      },
      now,
    );
    cache = { at: Date.now(), data };
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}
