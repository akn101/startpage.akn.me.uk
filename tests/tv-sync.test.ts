import { describe, it, expect, beforeEach, vi } from "vitest";
import { fake, mockDb } from "./helpers";
import { cleanAccountName, cleanInstitution, cleanPayee } from "@/lib/money-names";
import { DONE_LINGER_MS, mergeTodos, parseBondsTodoId } from "@/lib/todo-sync";
import { nextRepeat, parseRepeat } from "@/lib/when";
import { buildSnapshot } from "@/lib/money";

mockDb();
const gen = vi.fn(async () => ({ text: "fresh brief", ai: true }));
vi.doMock("@/lib/brief", () => ({ gatherBrief: async () => ({}), aiBrief: gen }));

describe("merchant names", () => {
  it.each([
    ["WEIXIN*Meituan platfor", null, "Meituan platfor"],
    ["Amazon Prime*BI84H65B4", null, "Amazon Prime"],
    ["SAVETHECHANGE-9760", null, "Savethechange"],
    ["MT263060421000010085553", "COSTA COFFEE 43010881  LONDON   GBR", "Costa Coffee"],
    ["774031 83489760", null, "Unknown"],
    ["LOAN       07NOV26,100000001855250723", null, "Loan"],
    ["NO REFERENCE,5338000011112222", null, "Unknown"],
    ["TfL Travel Charge", null, "TfL Travel Charge"],
  ])("%s", (payee, notes, want) => {
    expect(cleanPayee(payee, notes)).toBe(want);
  });
  it("falls back to the category, never to a WeChat receipt", () => {
    expect(cleanPayee("774031 83489760", null, "Transfers")).toBe("Transfers");
    expect(cleanPayee("", "美团 · 订单 123", "Food")).toBe("Food");
    expect(cleanPayee("", null, "Uncategorised")).toBe("Unknown");
  });
  it("masks account numbers and re-cases shouting", () => {
    expect(cleanAccountName("489396XXXXXX3383", "credit")).toBe("Card ·· 3383");
    expect(cleanAccountName("070976 XXXX2651", "cash")).toBe("Account ·· 2651");
    expect(cleanAccountName("GLOBAL MONEY ACCOUNT")).toBe("Global Money Account");
    expect(cleanAccountName("Starling")).toBe("Starling");
    expect(cleanInstitution("HSBC Personal")).toBe("HSBC");
    expect(cleanInstitution(null)).toBe("");
  });
  it("snapshot groups balances by currency, primary first, and lists bills to come", () => {
    const s = buildSnapshot({
      primaryCurrency: "gbp",
      assets: [
        { id: 1, type_name: "cash", name: "HKD acct", display_name: null, balance: "5000", to_base: 500, currency: "hkd", closed_on: null, institution_name: "HSBC Personal" },
        { id: 2, type_name: "cash", name: "GLOBAL MONEY ACCOUNT", display_name: null, balance: "100", to_base: 100, currency: "gbp", closed_on: null },
      ],
      plaid: [], categories: [], transactions: [],
      recurring: [
        { payee: "Netflix", amount: "10.99", currency: "gbp", billing_date: "2026-11-20" },
        { payee: "Old", amount: "1", currency: "gbp", billing_date: "2026-11-01" },
      ],
    }, new Date("2026-11-14T12:00:00Z"));
    expect(s.byCurrency.map((g) => [g.currency, g.total])).toEqual([["GBP", 100], ["HKD", 5000]]);
    expect(s.byCurrency[1].accounts[0].institution).toBe("HSBC");
    expect(s.upcoming).toEqual([{ date: "2026-11-20", payee: "Netflix", amount: -10.99, currency: "GBP" }]);
  });
});

describe("todos + Bonds merge", () => {
  const NOW = Date.parse("2026-11-14T15:00:00Z");
  const local = [
    { id: "a", text: "open local", done: false },
    { id: "b", text: "done just now", done: true, updated_at: new Date(NOW - 60_000).toISOString() },
    { id: "c", text: "done yesterday", done: true, updated_at: new Date(NOW - 86400_000).toISOString() },
  ];
  const bonds = [
    { id: 7, label: "later bonds", due_at: "2026-11-20", people: [] },
    { id: 3, label: "sooner bonds", due_at: "2026-11-15", people: ["Sam"] },
  ];
  it("open first (startpage, then Bonds by due), recent done after, old done dropped", () => {
    const m = mergeTodos(local, bonds, { now: NOW });
    expect(m.map((t) => t.id)).toEqual(["a", "bonds:3", "bonds:7", "b"]);
    expect(m[1]).toMatchObject({ source: "bonds", text: "sooner bonds", people: ["Sam"], done: false });
  });
  it("a Bonds task ticked here lingers, then drops off", () => {
    const ticked = { doneAt: { "bonds:3": NOW - 1000 }, doneIds: new Set(["bonds:3"]) };
    expect(mergeTodos([], bonds, { now: NOW, ...ticked }).map((t) => [t.id, t.done])).toEqual([["bonds:7", false], ["bonds:3", true]]);
    expect(mergeTodos([], bonds, { now: NOW + DONE_LINGER_MS, ...ticked }).map((t) => t.id)).toEqual(["bonds:7"]);
  });
  it("a local tick time wins over the server stamp", () => {
    expect(mergeTodos(local, [], { now: NOW, doneAt: { c: NOW - 5000 } }).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
  it("parses bonds ids strictly", () => {
    expect(parseBondsTodoId("bonds:42")).toBe(42);
    expect(parseBondsTodoId("bonds:x")).toBeNull();
    expect(parseBondsTodoId("42")).toBeNull();
    expect(parseBondsTodoId(42)).toBeNull();
  });
});

describe("repeating reminders", () => {
  it("parses daily/weekly out of the text", () => {
    expect(parseRepeat("journal every day")).toEqual({ text: "journal", repeat: "daily" });
    expect(parseRepeat("weekly review")).toEqual({ text: "review", repeat: "weekly" });
    expect(parseRepeat("journal")).toEqual({ text: "journal", repeat: null });
  });
  it("moves to the same London time on the next day or week, past now", () => {
    const now = new Date("2026-11-14T22:00:00Z");
    expect(nextRepeat("2026-11-14T21:00:00.000Z", "daily", now).toISOString()).toBe("2026-11-15T21:00:00.000Z");
    expect(nextRepeat("2026-11-10T21:00:00.000Z", "daily", now).toISOString()).toBe("2026-11-15T21:00:00.000Z");
    expect(nextRepeat("2026-11-14T21:00:00.000Z", "weekly", now).toISOString()).toBe("2026-11-21T21:00:00.000Z");
  });
  it("with no time, lands at 20:00 London tonight or tomorrow", () => {
    expect(nextRepeat(null, "daily", new Date("2026-11-14T10:00:00Z")).toISOString()).toBe("2026-11-14T20:00:00.000Z");
    expect(nextRepeat(null, "daily", new Date("2026-11-14T21:00:00Z")).toISOString()).toBe("2026-11-15T20:00:00.000Z");
  });
});

describe("brief cache", () => {
  beforeEach(() => { fake.tables = {}; gen.mockClear(); });
  it("staleness: missing, invalid, future, over an hour, or another London day", async () => {
    const { briefIsStale } = await import("@/lib/brief-cache");
    const now = new Date("2026-11-14T15:00:00Z");
    expect(briefIsStale(null, now)).toBe(true);
    expect(briefIsStale("nope", now)).toBe(true);
    expect(briefIsStale("2026-11-14T16:00:00Z", now)).toBe(true);
    expect(briefIsStale("2026-11-14T13:59:00Z", now)).toBe(true);
    expect(briefIsStale("2026-11-14T14:30:00Z", now)).toBe(false);
    expect(briefIsStale("2026-11-13T23:59:00Z", new Date("2026-11-14T00:10:00Z"))).toBe(true);
  });
  it("serves the cached row while fresh, regenerates and stores when stale", async () => {
    const { getCachedBrief } = await import("@/lib/brief-cache");
    const now = new Date();
    fake.seed("brief_cache", [{ user_id: "u1", text: "cached", ai: true, generated_at: new Date(now.getTime() - 10 * 60_000).toISOString() }]);
    const hit = await getCachedBrief("u1", { now });
    expect(hit.text).toBe("cached");
    expect(Date.parse(hit.nextAt) - Date.parse(hit.at)).toBe(60 * 60_000);
    expect(gen).not.toHaveBeenCalled();

    const later = new Date(now.getTime() + 61 * 60_000);
    const miss = await getCachedBrief("u1", { now: later });
    expect(miss.text).toBe("fresh brief");
    expect(gen).toHaveBeenCalledTimes(1);
    expect(fake.rows("brief_cache")).toHaveLength(1);
    expect(fake.rows("brief_cache")[0].text).toBe("fresh brief");
  });
  it("a forced refresh only regenerates a brief older than five minutes", async () => {
    const { getCachedBrief } = await import("@/lib/brief-cache");
    const now = new Date();
    fake.seed("brief_cache", [{ user_id: "u2", text: "young", ai: true, generated_at: new Date(now.getTime() - 60_000).toISOString() }]);
    expect((await getCachedBrief("u2", { now, force: true })).text).toBe("young");
    fake.seed("brief_cache", [{ user_id: "u2", text: "older", ai: true, generated_at: new Date(now.getTime() - 6 * 60_000).toISOString() }]);
    expect((await getCachedBrief("u2", { now, force: true })).text).toBe("fresh brief");
  });
});
