"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import PinPad from "@/components/tv/PinPad";
import Glyph from "./Glyph";
import {
  ago, CalEvent, dateOnlyLabel, dayLabel, dueLabel, eventDayKey, eventRange, eventSub, glyphKind, greeting,
  hourOf, money, startIndex, upcoming, Weather, weatherAlerts, weatherLabel,
} from "./tv-logic";
import { mergeTodos, type BondsTodo, type SyncedTodo } from "@/lib/todo-sync";
import "./tv.css";

// The web bubbles; the native Bubbles.java is a port of this.
const Screensaver = dynamic(() => import("@/components/Screensaver"), { ssr: false });

const MIN = 60_000;
const REFRESH_EVERY = 5 * MIN, WEATHER_EVERY = 30 * MIN, IDLE_AFTER = 10 * MIN, TOUCH_EVERY = 4 * MIN;
const AUTO_LOCK = 10 * MIN, NIGHT_WAKE = 60_000;
const BRIEF_EVERY = 60 * MIN, BRIEF_RETRY = 10 * MIN;
const GUEST_MODULES = ["clock", "weather"];
const OWNER_MODULES = ["clock", "weather", "calendar", "money", "brief", "todos", "mind", "github", "music", "ask"];
const KNOWN_CARDS = ["weather", "calendar", "brief", "todos", "mind", "github", "money", "music"];
const TITLES: Record<string, string> = {
  weather: "Weather", calendar: "Coming up", brief: "Morning brief", todos: "Todos", mind: "On your mind",
  github: "GitHub", money: "Money", music: "Music",
};
const DETAIL_TITLES: Record<string, string> = { ...TITLES, calendar: "Next 7 days" };

type Res<T> = { status: number; data: T | null; error?: string };
async function getJson<T>(url: string, init?: RequestInit): Promise<Res<T>> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init });
    const d = await r.json().catch(() => null);
    return { status: r.status, data: r.ok ? (d as T) : null, error: d && typeof d.error === "string" ? d.error : undefined };
  } catch {
    return { status: 0, data: null };
  }
}
const send = (url: string, method: string, body: object) =>
  getJson<unknown>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

type LockState = { signedIn: boolean; pinConfigured?: boolean; unlocked?: { private: boolean; sensitive: boolean } };
type TvConfig = {
  profile: "owner" | "guest"; modules: string[]; pinConfigured?: boolean; displayName?: string;
  location?: { lat?: number; lon?: number; name?: string; tz?: string; timezone?: string } | null; timezone?: string;
};
type Todo = { id: string; text: string; done: boolean; updated_at?: string | null };
type TodoRes = { todos: Todo[]; bonds?: BondsTodo[]; bondsLocked?: boolean; bondsError?: string };
type Alarm = { time: string; label?: string; enabled: boolean };
type MindItem = { id: string; kind: string; text: string; person: string | null; due_at: string | null; done: boolean; repeat?: string | null };
type Bonds = { tasks: { id: number; label: string; due_at: string | null }[]; reminders: { id: number; label: string; person: string; next: string | null }[] } | null;
type GhItem = { title: string; url: string; repo: string; owner: string; createdAt: string; ci: string | null };
type Github = { prs: GhItem[]; reviews: GhItem[]; issues: GhItem[]; repos: { name: string; owner: string; url: string; pushedAt: string; ci: string | null }[] };
type MoneyTx = { date: string; payee: string; amount: number; currency: string; category: string };
type MoneyAccount = { name: string; institution: string; balance: number; currency: string; type: string; liability: boolean };
type Money = {
  accounts: MoneyAccount[];
  byCurrency?: { currency: string; total: number; accounts: MoneyAccount[] }[];
  netWorth: { amount: number; currency: string };
  month: {
    spent: number; income: number; currency: string; topCategories: { name: string; amount: number }[];
    largest?: MoneyTx[]; uncategorised?: number;
  };
  recent: MoneyTx[];
  upcoming?: { date: string; payee: string; amount: number; currency: string }[];
};
type Brief = { text: string; ai?: boolean; at?: string; nextAt?: string };
type Pin = { scope: "private" | "sensitive"; title: string; then?: () => void };

const isTvUa = () => typeof navigator !== "undefined" && navigator.userAgent.includes("StartpageTV");

function ciMark(ci: string | null): Mark {
  if (ci === "SUCCESS") return { color: "var(--tvh-good)", filled: true };
  if (ci === "FAILURE" || ci === "ERROR") return { color: "var(--tvh-bad)", filled: true };
  if (ci === "PENDING") return { color: "var(--tvh-warn)", filled: true };
  return { color: "var(--tvh-faint)", filled: false };
}
const ciText = (ci: string | null) =>
  ci === "SUCCESS" ? "CI passing" : ci === "FAILURE" || ci === "ERROR" ? "CI failing" : ci === "PENDING" ? "CI running" : "";
const prNumber = (url: string) => url.match(/\/(\d+)$/)?.[1];

// ── small views ──────────────────────────────────────────────────────────

type Mark = { color: string; filled: boolean };
type RowProps = {
  main: React.ReactNode; sub?: React.ReactNode; mark?: Mark; muted?: boolean; done?: boolean; subAccent?: boolean;
  onClick?: () => void;
};
function Row({ main, sub, mark, muted, done, subAccent, onClick }: RowProps) {
  const inner = (
    <>
      {mark && <span className={`tvh-mark${mark.filled ? " filled" : ""}`} style={{ color: mark.color }} />}
      <span className="tvh-row-text">
        <span className={`tvh-row-main${muted ? " muted" : ""}${done ? " done" : ""}`}>{main}</span>
        {sub && <span className={`tvh-row-sub${subAccent ? " accent" : ""}`}>{sub}</span>}
      </span>
    </>
  );
  return onClick
    ? <button type="button" className="tvh-row clickable" data-nav onClick={onClick}>{inner}</button>
    : <div className="tvh-row">{inner}</div>;
}

const Note = ({ text }: { text: string }) => <Row main={text} muted />;

// ── the page ─────────────────────────────────────────────────────────────

export default function TvHome() {
  const [lock, setLock] = useState<LockState | null>(null);
  const [config, setConfig] = useState<TvConfig | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [cal, setCal] = useState<Res<{ events: CalEvent[]; status?: string }> | null>(null);
  const [todoRes, setTodoRes] = useState<TodoRes | null>(null);
  // Local tick times (ms) and Bonds tasks ticked here, so a ticked row lingers briefly, then drops off.
  const [doneAt, setDoneAt] = useState<Record<string, number>>({});
  const [bondsTicked, setBondsTicked] = useState<Record<string, BondsTodo>>({});
  const [mind, setMind] = useState<Res<{ items: MindItem[]; bonds: Bonds }> | null>(null);
  const [gh, setGh] = useState<Res<Github> | null>(null);
  const [cash, setCash] = useState<Res<Money> | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefState, setBriefState] = useState<"idle" | "loading" | "failed" | "locked">("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [idle, setIdle] = useState(false);
  const [night, setNight] = useState(false);
  const [tvUa, setTvUa] = useState(false);

  const lastInput = useRef(Date.now());
  const lastRefresh = useRef(0);
  const lastWeather = useRef(0);
  const lastTouch = useRef(0);
  const lastGate = useRef(0);
  const briefNext = useRef(0);
  const briefBusy = useRef(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const locking = useRef(false);
  const idleRef = useRef(false);
  const detailFrom = useRef<HTMLElement | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const owner = config?.profile === "owner";
  const signedIn = !!lock?.signedIn;
  const pinConfigured = !!(lock?.pinConfigured ?? config?.pinConfigured);
  const tz = config?.location?.tz || config?.location?.timezone || config?.timezone || undefined;

  // ── data ───────────────────────────────────────────────────────────────

  const check = useCallback(async () => {
    const s = await getJson<LockState>("/api/lock/state");
    const st = s.data ?? { signedIn: false };
    setLock(st);
    const c = await getJson<TvConfig>("/api/tv/config");
    const unlocked = st.signedIn && !!st.unlocked?.private;
    setConfig(c.data ?? { profile: unlocked ? "owner" : "guest", modules: unlocked ? OWNER_MODULES : GUEST_MODULES });
    locking.current = false;
  }, []);

  /** A whole-session lock (423 locked) or a lost session: ask the server again what this screen may show. */
  const gate = useCallback((r: Res<unknown>) => {
    if (r.status === 401 || (r.status === 423 && r.error === "locked")) {
      // Several loads can hit this at once; ask once, and never in a tight loop.
      if (Date.now() - lastGate.current > 5000) { lastGate.current = Date.now(); void check(); }
      return true;
    }
    return false;
  }, [check]);

  const modules = useMemo(() => config?.modules ?? [], [config]);
  const has = useCallback((m: string) => modules.includes(m), [modules]);

  const loadWeather = useCallback(async () => {
    lastWeather.current = Date.now();
    let lat = config?.location?.lat, lon = config?.location?.lon, city = config?.location?.name ?? "";
    if (typeof lat !== "number" || typeof lon !== "number") {
      // ipapi.co rate-limits shared IPs; ipwho.is answers with the same field names.
      for (const u of ["https://ipapi.co/json/", "https://ipwho.is/"]) {
        const g = await getJson<{ latitude?: number; longitude?: number; city?: string }>(u);
        if (typeof g.data?.latitude === "number" && typeof g.data.longitude === "number") {
          lat = g.data.latitude; lon = g.data.longitude; city = g.data.city ?? ""; break;
        }
      }
    }
    if (typeof lat !== "number" || typeof lon !== "number") { setWeatherFailed(true); return; }
    const ll = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`;
    const [w, air] = await Promise.all([
      getJson<Weather>(`https://api.open-meteo.com/v1/forecast?${ll}&current=temperature_2m,weathercode,apparent_temperature`
        + "&hourly=temperature_2m,weathercode,precipitation_probability,uv_index&forecast_hours=26&daily=weathercode,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto"),
      // Pollen (Europe only) and air quality: shown only when they matter.
      getJson<Weather["_air"]>(`https://air-quality-api.open-meteo.com/v1/air-quality?${ll}`
        + "&hourly=us_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&forecast_hours=12&timezone=auto"),
    ]);
    if (!w.data?.current) { setWeatherFailed(true); return; }
    setWeather({ ...w.data, _air: air.data ?? undefined, _city: city });
    setWeatherFailed(false);
  }, [config]);

  const loadTodos = useCallback(async () => {
    const r = await getJson<TodoRes>("/api/data/todos");
    if (gate(r)) return;
    setTodoRes(r.data ?? { todos: [] });
  }, [gate]);

  const loadMind = useCallback(async () => {
    const r = await getJson<{ items: MindItem[]; bonds: Bonds }>("/api/mind");
    if (gate(r)) return;
    setMind(r);
    setDoneIds(new Set());
  }, [gate]);

  const loadMoney = useCallback(async () => {
    const r = await getJson<Money>("/api/money");
    if (gate(r)) return;
    setCash(r);
  }, [gate]);

  /** The brief is cached server-side for an hour; this re-reads it when the cached one says it is due. */
  const loadBrief = useCallback(async (force = false) => {
    if (briefBusy.current) return;
    briefBusy.current = true;
    briefNext.current = Date.now() + BRIEF_RETRY; // until we know better
    setBriefState((s) => (s === "locked" ? s : "loading"));
    const r = await getJson<Brief>(`/api/brief${force ? "?refresh=1" : ""}`);
    briefBusy.current = false;
    if (r.status === 423 && r.error !== "locked") { setBriefState("locked"); briefNext.current = Date.now() + BRIEF_EVERY; return; }
    if (gate(r)) { setBriefState("idle"); return; }
    if (!r.data?.text) { setBriefState("failed"); return; }
    setBrief(r.data);
    setBriefState("idle");
    const due = r.data.nextAt ? Date.parse(r.data.nextAt) : NaN;
    // A minute's slack so the server sees it as stale; never sooner than five minutes.
    briefNext.current = Math.max(Date.now() + 5 * MIN, Number.isFinite(due) ? due + MIN : Date.now() + BRIEF_EVERY);
  }, [gate]);

  const refresh = useCallback(() => {
    if (!config) return;
    lastRefresh.current = Date.now();
    const jobs: Promise<unknown>[] = [];
    if (owner) jobs.push(getJson<{ alarms: Alarm[] }>("/api/data/alarms").then((r) => setAlarms(r.data?.alarms ?? [])));
    if (has("calendar")) jobs.push(getJson<{ events: CalEvent[]; status?: string }>("/api/integrations/calendar").then((r) => { if (!gate(r)) setCal(r); }));
    if (has("todos")) jobs.push(loadTodos());
    if (has("mind")) jobs.push(loadMind());
    if (has("github")) jobs.push(getJson<Github>("/api/integrations/github").then((r) => { if (!gate(r)) setGh(r); }));
    if (has("money")) jobs.push(loadMoney());
    return Promise.all(jobs);
  }, [config, owner, has, gate, loadTodos, loadMind, loadMoney]);

  // A new profile (unlock, lock, sign-in) re-reads the brief straight away.
  useEffect(() => {
    if (!config) return;
    if (has("brief")) { briefNext.current = 0; void loadBrief(); }
    else { setBrief(null); setBriefState("idle"); }
  }, [config, has, loadBrief]);

  useEffect(() => { setTvUa(isTvUa()); void check(); }, [check]);
  useEffect(() => {
    if (!config) return;
    void refresh();
    if (has("weather")) void loadWeather();
  }, [config, refresh, loadWeather, has]);

  // ── clock, idle, night, keep-alive (every second) ─────────────────────

  const zonedHour = useCallback((ms: number) => {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(ms);
    return Number(h) % 24;
  }, [tz]);

  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const h = zonedHour(n);
      setNight((h >= 22 || h < 7) && n - lastInput.current > NIGHT_WAKE);
      // Ten minutes untouched: the owner's unlock ends (TV sessions only; the TV app's own TvMode covers StartpageTV).
      if (owner && pinConfigured && !tvUa && !locking.current && n - lastInput.current > AUTO_LOCK) {
        locking.current = true;
        setDetail(null);
        void fetch("/api/lock/lock", { method: "POST", cache: "no-store" }).catch(() => {}).then(() => check());
      }
      if (!idleRef.current && n - lastInput.current > IDLE_AFTER && !pin) { idleRef.current = true; setIdle(true); }
      if (n - lastRefresh.current > REFRESH_EVERY) void refresh();
      if (has("weather") && n - lastWeather.current > WEATHER_EVERY) void loadWeather();
      if (has("brief") && n > briefNext.current) void loadBrief();
      // Keep the PIN unlock alive only while someone is using the screen.
      if (owner && pinConfigured && n - lastInput.current < 15 * MIN && n - lastTouch.current > TOUCH_EVERY) {
        lastTouch.current = n;
        void getJson("/api/lock/touch", { method: "POST" }).then((r) => { if (r.status === 423) void check(); });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [zonedHour, owner, pinConfigured, tvUa, check, pin, refresh, has, loadWeather, loadBrief]);

  // ── input: wake, arrows, Escape ───────────────────────────────────────

  const closeDetail = useCallback(() => {
    setDetail(null);
    setArmed(null);
    const from = detailFrom.current;
    setTimeout(() => from?.focus(), 0);
  }, []);

  useEffect(() => {
    const wake = (e: Event) => {
      lastInput.current = Date.now();
      locking.current = false;
      if (idleRef.current) {
        // The first key or click only wakes the screen.
        idleRef.current = false;
        setIdle(false);
        e.preventDefault();
        e.stopImmediatePropagation();
        return true;
      }
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (wake(e)) return;
      const dir = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.key] as Dir | undefined;
      if (dir) { e.preventDefault(); moveFocus(dir); return; }
      if ((e.key === "Escape" || e.key === "Backspace") && detail && !pin) { e.preventDefault(); closeDetail(); }
    };
    const onPointer = (e: Event) => { wake(e); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("wheel", onPointer, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("wheel", onPointer, true);
    };
  }, [detail, pin, closeDetail]);

  // ── actions ───────────────────────────────────────────────────────────

  const askPin = useCallback((scope: Pin["scope"], then?: () => void) => {
    setPin({ scope, title: scope === "sensitive" && owner ? "Confirm it's you" : "Unlock my setup", then });
  }, [owner]);

  const openDetail = useCallback((id: string) => {
    if (!owner && id !== "weather") return; // non-owners only get the weather
    if (id === "music") { window.location.href = "/tv/music"; return; }
    const locked = (id === "mind" && mind?.status === 423) || (id === "money" && cash?.status === 423);
    if (locked) {
      askPin("sensitive", () => { void (id === "mind" ? loadMind() : loadMoney()).then(() => setDetail(id)); });
      return;
    }
    if (id === "brief" && briefState === "locked") {
      askPin("private", () => { briefNext.current = 0; void loadBrief(); });
      return;
    }
    detailFrom.current = document.activeElement as HTMLElement | null;
    setDetail(id);
    if (id === "brief" && !brief && briefState !== "loading") void loadBrief();
  }, [owner, mind, cash, brief, briefState, askPin, loadMind, loadMoney, loadBrief]);

  const toggleTodo = useCallback(async (t: SyncedTodo) => {
    const done = !t.done;
    setDoneAt((m) => { const x = { ...m }; if (done) x[t.id] = Date.now(); else delete x[t.id]; return x; });
    if (t.source === "bonds") {
      const orig = todoRes?.bonds?.find((b) => `bonds:${b.id}` === t.id) ?? bondsTicked[t.id];
      setBondsTicked((m) => {
        const x = { ...m };
        if (done && orig) x[t.id] = orig; else delete x[t.id];
        return x;
      });
    } else {
      setTodoRes((r) => r && { ...r, todos: r.todos.map((x) => (x.id === t.id ? { ...x, done } : x)) });
    }
    const r = await send("/api/data/todos", "PATCH", { id: t.id, done });
    if (r.status === 423 && r.error !== "locked") { askPin("private", () => void toggleTodo(t)); }
    else if (gate(r)) return;
    if (r.status < 200 || r.status >= 300) {
      // Put it back the way the server has it.
      setDoneAt((m) => { const x = { ...m }; delete x[t.id]; return x; });
      setBondsTicked((m) => { const x = { ...m }; delete x[t.id]; return x; });
    }
    void loadTodos();
  }, [gate, loadTodos, todoRes, bondsTicked, askPin]);

  const pressMind = useCallback(async (it: MindItem) => {
    if (doneIds.has(it.id)) return;
    if (armed !== it.id) {
      // First press arms the row; it disarms itself after 4s.
      setArmed(it.id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed((a) => (a === it.id ? null : a)), 4000);
      return;
    }
    setArmed(null);
    setDoneIds((s) => new Set(s).add(it.id));
    const r = await send("/api/mind", "PATCH", { id: it.id, done: true });
    if (r.status === 423 && r.error !== "locked") {
      setDoneIds((s) => { const x = new Set(s); x.delete(it.id); return x; });
      askPin("sensitive", () => void loadMind());
      return;
    }
    if (gate(r)) return;
    void loadMind();
  }, [armed, doneIds, askPin, gate, loadMind]);

  const lockNow = useCallback(async () => {
    setDetail(null);
    await fetch("/api/lock/lock", { method: "POST", cache: "no-store" }).catch(() => {});
    await check();
  }, [check]);

  // ── derived ───────────────────────────────────────────────────────────

  const calHidden = cal?.data?.status === "unconfigured";
  const ghRows = useMemo(() => {
    const d = gh?.data;
    if (!d) return [];
    const items = [
      ...(d.reviews ?? []).map((x) => ({ ...x, kind: "Review" })),
      ...(d.prs ?? []).map((x) => ({ ...x, kind: "PR" })),
      ...(d.issues ?? []).map((x) => ({ ...x, kind: "Issue" })),
    ];
    if (items.length) return items.slice(0, 40).map((x) => ({ key: x.url + x.kind, main: x.title, sub: `${x.kind} · ${x.repo}`, mark: ciMark(x.ci) }));
    return (d.repos ?? []).slice(0, 6).map((r) => ({ key: r.url, main: r.name, sub: `pushed ${ago(Date.parse(r.pushedAt))}`, mark: ciMark(r.ci) }));
  }, [gh]);
  const ghOpen = (gh?.data?.reviews?.length ?? 0) + (gh?.data?.prs?.length ?? 0) + (gh?.data?.issues?.length ?? 0);

  const cards = useMemo(() => modules.filter((m) => m !== "clock" && m !== "ask" && KNOWN_CARDS.includes(m)).filter((m) => {
    if (m === "calendar") return !calHidden;
    if (m === "money") return !(cash && (cash.status === 404 || cash.status === 503));
    if (m === "github") return !gh || gh.status !== 200 || ghRows.length > 0;
    return true;
  }), [modules, calHidden, cash, gh, ghRows]);

  const todoList = useMemo(() => {
    const server = todoRes?.bonds ?? [];
    const seen = new Set(server.map((b) => `bonds:${b.id}`));
    const bonds = [...server, ...Object.entries(bondsTicked).filter(([k]) => !seen.has(k)).map(([, b]) => b)];
    return mergeTodos(todoRes?.todos ?? [], bonds, { now, doneAt, doneIds: new Set(Object.keys(bondsTicked)) });
  }, [todoRes, bondsTicked, doneAt, now]);

  type MindRow =
    | { kind: "item"; key: string; main: React.ReactNode; sub: string; item: MindItem }
    | { kind: "bonds"; key: string; main: React.ReactNode; sub: string };
  const mindGroups = useMemo(() => {
    const items = (mind?.data?.items ?? []).filter((i) => !i.done);
    const due = (i: MindItem) => (i.due_at ? Date.parse(i.due_at) : Infinity);
    const wishes: MindRow[] = items.filter((i) => i.kind === "wish").map((i) => ({
      kind: "item", key: i.id, item: i, sub: "",
      main: i.person
        ? <><span className="tvh-person">{i.person}</span> wants you to {i.text.replace(/^(?:wants you )?to\s+/i, "")}</>
        : i.text,
    }));
    const reminders: (MindRow & { at: number })[] = items.filter((i) => i.kind === "reminder").map((i) => ({
      kind: "item", key: i.id, item: i, main: i.text, at: due(i),
      sub: [i.repeat === "daily" ? "Every day" : i.repeat === "weekly" ? "Every week" : "", i.due_at ? dueLabel(Date.parse(i.due_at), now) : "", i.person ?? ""].filter(Boolean).join(" · "),
    }));
    for (const r of mind?.data?.bonds?.reminders ?? []) {
      reminders.push({
        kind: "bonds", key: `br${r.id}`, main: r.label, at: r.next ? Date.parse(r.next) : Infinity,
        sub: [r.person, dateOnlyLabel(r.next), "Bonds"].filter(Boolean).join(" · "),
      });
    }
    reminders.sort((a, b) => a.at - b.at);
    const thoughts: MindRow[] = items.filter((i) => i.kind !== "wish" && i.kind !== "reminder").map((i) => ({
      kind: "item", key: i.id, item: i, main: i.text, sub: i.person ?? "",
    }));
    return [
      { key: "wish", title: "People want for you", rows: wishes },
      { key: "reminder", title: "Reminders", rows: reminders as MindRow[] },
      { key: "thought", title: "Thoughts", rows: thoughts },
    ];
  }, [mind, now]);

  // ── rendering ─────────────────────────────────────────────────────────

  const clockText = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(now);
  const dateText = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now).replace(",", "").toUpperCase();
  const greet = greeting(zonedHour(now), config?.displayName);
  const hero = cards.length <= 2;
  const perRow = cards.length <= 4 ? cards.length : Math.ceil(cards.length / 2);
  // Native drops the big glyph when the weather card is narrower than 340dp (4+ cards to a row at 1440px).
  const wideCards = hero || perRow <= 3;

  const lockedRows = <><Row main="Locked" /><Row main="Press OK to unlock" muted /></>;
  const timeText = (iso: string | undefined) =>
    iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(Date.parse(iso)) : "";
  const openMark: Mark = { color: "var(--tvh-muted)", filled: false };
  const doneMark: Mark = { color: "var(--tvh-good)", filled: true };

  function todoSub(t: SyncedTodo, clickable: boolean): string {
    if (t.done) return clickable ? "Done · OK to reopen" : "Done";
    const bits = [t.source === "bonds" ? "Bonds" : "", t.due_at ? dateOnlyLabel(t.due_at) : "", t.people.join(", ")];
    if (clickable) bits.push("OK to mark done");
    return bits.filter(Boolean).join(" · ");
  }

  function cardBody(id: string): { body: React.ReactNode; meta?: string; extra?: number } {
    switch (id) {
      case "weather": {
        if (!weather) return { body: <Note text={weatherFailed ? "Weather unavailable" : "Loading…"} /> };
        const c = weather.current;
        const hi = weather.daily?.temperature_2m_max?.[0], lo = weather.daily?.temperature_2m_min?.[0];
        const alerts = weatherAlerts(weather);
        const start = startIndex(weather);
        const strip: number[] = [];
        for (let i = start + 2; i < weather.hourly.time.length && i <= start + 11; i += 3) strip.push(i);
        const on = alarms.filter((a) => a.enabled);
        return {
          body: (
            <>
              <div className="tvh-wx-big">
                <span className="tvh-wx-temp">{Math.round(c.temperature_2m)}°</span>
                <span className="tvh-wx-side">
                  <span className="tvh-wx-label">{weatherLabel(c.weathercode)}</span>
                  <span className="tvh-wx-sub">Feels {Math.round(c.apparent_temperature)}°{hi != null && lo != null ? ` · H ${Math.round(hi)}° L ${Math.round(lo)}°` : ""}</span>
                  {weather._city && <span className="tvh-wx-city">{weather._city}</span>}
                </span>
                {wideCards && <Glyph kind={glyphKind(c.weathercode)} size={40} />}
              </div>
              {alerts.length > 0 && <div className="tvh-wx-alerts">{alerts.join("  ·  ")}</div>}
              <div className="tvh-wx-strip">
                {strip.map((i) => (
                  <span key={i} className="tvh-wx-hour">
                    <span className="tvh-faint">{hourOf(weather.hourly.time[i])}</span>
                    <Glyph kind={glyphKind(weather.hourly.weathercode[i])} size={20} />
                    <span className="tvh-muted">{Math.round(weather.hourly.temperature_2m[i])}°</span>
                  </span>
                ))}
              </div>
              {on.length > 0 && (
                <div className="tvh-alarms">ALARM{"   "}{on.map((a) => `${a.time.slice(0, 5)}${a.label ? ` ${a.label}` : ""}`).join("   ·   ")}</div>
              )}
            </>
          ),
        };
      }
      case "calendar": {
        if (!cal) return { body: <Note text="Loading…" /> };
        const evs = upcoming(cal.data?.events ?? []);
        if (cal.status !== 200 || !cal.data) return { body: <Note text="Calendar unavailable" /> };
        if (!evs.length) return { body: <Note text="Nothing coming up" /> };
        const shown = evs.slice(0, 10);
        return { extra: evs.length - shown.length, body: shown.map((e) => <Row key={e.uid + e.start} main={e.summary} sub={eventSub(e)} />) };
      }
      case "todos": {
        if (!todoRes) return { body: <Note text="Loading…" /> };
        const open = todoList.filter((t) => !t.done);
        const shown = open.slice(0, 12);
        return {
          meta: open.length ? `${open.length} OPEN` : undefined,
          extra: open.length - shown.length,
          body: shown.length
            ? shown.map((t) => <Row key={t.id} main={t.text} sub={todoSub(t, false) || undefined} mark={openMark} />)
            : <Note text={todoRes.bondsLocked ? "All clear here · Bonds tasks locked" : "All clear"} />,
        };
      }
      case "mind": {
        if (!mind) return { body: <Note text="Loading…" /> };
        if (mind.status === 423) return { body: lockedRows };
        if (!mind.data) return { body: <Note text="Mind unavailable" /> };
        const total = mindGroups.reduce((n, g) => n + g.rows.length, 0);
        return { meta: total ? String(total) : undefined, body: total ? mindListRows(false) : <Note text="Nothing on your mind" /> };
      }
      case "github": {
        if (!gh) return { body: <Note text="Loading…" /> };
        if (gh.status !== 200) return { body: <Note text="GitHub unavailable" /> };
        const shown = ghRows.slice(0, 10);
        return {
          meta: ghOpen ? `${ghOpen} OPEN` : undefined,
          extra: ghRows.length - shown.length,
          body: shown.map((r) => <Row key={r.key} main={r.main} sub={r.sub} mark={r.mark} />),
        };
      }
      case "money": {
        if (!cash) return { body: <Note text="Loading…" /> };
        if (cash.status === 423) return { body: lockedRows };
        const d = cash.data;
        if (!d) return { body: <Note text="Money unavailable" /> };
        const m = d.month;
        const f = m.income > 0 ? Math.min(1, m.spent / m.income) : m.spent > 0 ? 1 : 0;
        const top = m.topCategories[0]?.amount || 1;
        return {
          meta: "THIS MONTH",
          body: (
            <>
              <div className="tvh-money-big">{money(d.netWorth.amount, d.netWorth.currency, true)}</div>
              <div className="tvh-faint tvh-small">net worth</div>
              <div className="tvh-money-line"><span>Spent {money(m.spent, m.currency, true)}</span><span className="tvh-muted">In {money(m.income, m.currency, true)}</span></div>
              <div className="tvh-bar"><span style={{ width: `${f * 100}%`, background: m.spent > m.income && m.income > 0 ? "var(--tvh-bad)" : "var(--tvh-accent)" }} /></div>
              {m.topCategories.slice(0, 4).map((c) => (
                <div key={c.name} className="tvh-money-cat" data-fit-item="">
                  <span className="tvh-muted">{c.name}</span><span>{money(Math.abs(c.amount), m.currency, true)}</span>
                  <i className="tvh-catbar" style={{ width: `${Math.max(4, (Math.abs(c.amount) / top) * 100)}%` }} />
                </div>
              ))}
            </>
          ),
        };
      }
      case "brief": {
        if (briefState === "locked") return { body: lockedRows };
        if (!brief) {
          return { body: <Note text={briefState === "failed" ? "Brief unavailable · trying again shortly" : "Writing today's brief…"} /> };
        }
        return {
          meta: brief.at ? `UPDATED ${timeText(brief.at)}` : undefined,
          body: <p className="tvh-brief">{brief.text}</p>,
        };
      }
      case "music":
        return { body: <><Row main="Open the player" /><Row main="Albums, playlists and radio" muted /></> };
    }
    return { body: null };
  }

  /**
   * Mind, grouped: what people want for you, reminders (Mind and Bonds), thoughts.
   * In the detail, items arm on the first OK and are marked done on the second.
   */
  function mindListRows(clickable: boolean): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (const g of mindGroups) {
      if (!g.rows.length) continue;
      out.push(<div key={`h-${g.key}`} className="tvh-group-h">{g.title}</div>);
      for (const r of g.rows) {
        if (r.kind === "bonds") {
          out.push(<Row key={r.key} main={r.main} sub={r.sub} mark={{ color: "var(--tvh-accent)", filled: false }} />);
          continue;
        }
        const i = r.item;
        const isDone = doneIds.has(i.id);
        const sub = isDone ? "Done" : armed === i.id ? (i.repeat ? "Press OK again: done for today" : "Press OK again to mark done") : r.sub;
        out.push(
          <Row key={r.key} main={r.main} muted={isDone} sub={sub || undefined} subAccent={armed === i.id && !isDone}
            mark={isDone ? doneMark : { color: g.key === "wish" ? "var(--tvh-accent)" : "var(--tvh-muted)", filled: g.key === "wish" }}
            onClick={clickable ? () => void pressMind(i) : undefined} />,
        );
      }
    }
    return out;
  }

  function detailBody(id: string): React.ReactNode {
    switch (id) {
      case "weather": {
        if (!weather) return <Note text={weatherFailed ? "Weather unavailable" : "Loading…"} />;
        const start = startIndex(weather);
        const hours: number[] = [];
        for (let i = start; i < weather.hourly.time.length && i < start + 24; i += 2) hours.push(i);
        const alerts = weatherAlerts(weather);
        const d = weather.daily;
        return (
          <>
            {alerts.length > 0 && <div className="tvh-wx-alerts">{alerts.join("  ·  ")}</div>}
            <div className="tvh-wx-strip wide">
              {hours.map((i) => (
                <span key={i} className="tvh-wx-hour">
                  <span className="tvh-faint">{hourOf(weather.hourly.time[i])}</span>
                  <Glyph kind={glyphKind(weather.hourly.weathercode[i])} size={24} />
                  <span>{Math.round(weather.hourly.temperature_2m[i])}°</span>
                  <span className="tvh-faint tvh-small">{weather.hourly.precipitation_probability[i] ?? 0}%</span>
                </span>
              ))}
            </div>
            <div className="tvh-days">
              {d?.time.map((t, i) => (
                <div key={t} className="tvh-day">
                  <span>{i === 0 ? "Today" : dayLabel(new Date(`${t}T12:00:00`))}</span>
                  <Glyph kind={glyphKind(d.weathercode[i])} size={24} />
                  <span className="tvh-muted">{weatherLabel(d.weathercode[i])}</span>
                  <span>{Math.round(d.temperature_2m_max[i])}° <span className="tvh-faint">{Math.round(d.temperature_2m_min[i])}°</span></span>
                </div>
              ))}
            </div>
          </>
        );
      }
      case "calendar": {
        if (!cal?.data || cal.status !== 200) return <Note text="Calendar unavailable" />;
        const limit = Date.now() + 7 * 24 * 3600_000;
        const evs = upcoming(cal.data.events).filter((e) => Date.parse(e.start) < limit);
        if (!evs.length) return <Note text="Nothing in the next 7 days" />;
        const groups = new Map<string, CalEvent[]>();
        for (const e of evs) groups.set(eventDayKey(e), [...(groups.get(eventDayKey(e)) ?? []), e]);
        return [...groups.entries()].map(([k, list]) => (
          <section key={k} className="tvh-section">
            <h3>{dayLabel(new Date(`${k}T12:00:00`))}</h3>
            {list.map((e) => <Row key={e.uid + e.start} main={e.summary} sub={[eventRange(e), e.location].filter(Boolean).join(" · ")} />)}
          </section>
        ));
      }
      case "todos": {
        if (!todoRes) return <Note text="Loading…" />;
        const rows = todoList.map((t) => (
          <Row key={t.id} main={t.text} muted={t.done} sub={todoSub(t, true)} mark={t.done ? doneMark : openMark}
            onClick={() => void toggleTodo(t)} />
        ));
        return (
          <>
            {rows.length ? rows : <Note text="All clear" />}
            {todoRes.bondsLocked && <Note text="Bonds tasks are hidden until you unlock" />}
            {todoRes.bondsError && <Note text="Bonds is not answering; showing startpage todos only" />}
            <p className="tvh-hint">Ticked items leave the list after ten minutes · same list as the startpage and Bonds</p>
          </>
        );
      }
      case "mind": {
        if (mind?.status === 423) return lockedRows;
        const rows = mindListRows(true);
        return rows.length ? rows : <Note text="Nothing on your mind" />;
      }
      case "github": {
        const d = gh?.data;
        if (!d) return <Note text="GitHub unavailable" />;
        const section = (title: string, list: GhItem[]) => list.length > 0 && (
          <section key={title} className="tvh-section">
            <h3>{title}</h3>
            {list.map((x) => (
              <Row key={x.url} main={x.title} mark={ciMark(x.ci)}
                sub={[`${x.repo}${prNumber(x.url) ? ` #${prNumber(x.url)}` : ""}`, ciText(x.ci), ago(Date.parse(x.createdAt))].filter(Boolean).join(" · ")} />
            ))}
          </section>
        );
        const any = d.reviews.length + d.prs.length + d.issues.length > 0;
        return any ? (
          <>
            {section(`Waiting on your review · ${d.reviews.length}`, d.reviews)}
            {section("Pull requests", d.prs)}
            {section("Issues", d.issues)}
          </>
        ) : (
          <section className="tvh-section">
            <h3>Recently pushed</h3>
            {d.repos.map((r) => <Row key={r.url} main={`${r.owner}/${r.name}`} sub={[ciText(r.ci), `pushed ${ago(Date.parse(r.pushedAt))}`].filter(Boolean).join(" · ")} mark={ciMark(r.ci)} />)}
          </section>
        );
      }
      case "money": {
        const d = cash?.data;
        if (cash?.status === 423) return lockedRows;
        if (!d) return <Note text="Money unavailable" />;
        return <MoneyDetail d={d} />;
      }
      case "brief":
        if (briefState === "locked") return lockedRows;
        if (!brief) return <Note text={briefState === "failed" ? "Brief unavailable · trying again shortly" : "Writing today's brief…"} />;
        return (
          <>
            <p className="tvh-brief-full">{brief.text}</p>
            <p className="tvh-hint">
              {[brief.at && `Updated ${timeText(brief.at)}`, brief.nextAt && `next ${timeText(brief.nextAt)}`, brief.ai === false && "plain summary"].filter(Boolean).join(" · ")}
            </p>
          </>
        );
    }
    return null;
  }
  const actions: React.ReactNode[] = [];
  if (owner) {
    actions.push(<button key="r" type="button" className="tvh-ghost" data-nav onClick={() => void refresh()}>Refresh</button>);
    if (pinConfigured) actions.push(<button key="l" type="button" className="tvh-ghost" data-nav onClick={() => void lockNow()}>Lock</button>);
  } else if (lock && !signedIn) {
    actions.push(<a key="s" className="tvh-ghost" data-nav href="/access">Sign in</a>);
  } else if (signedIn && pinConfigured) {
    actions.push(<button key="u" type="button" className="tvh-ghost" data-nav onClick={() => askPin("sensitive", () => void check())}>Unlock my setup</button>);
  }

  const cardEls = cards.map((id, i) => {
    const { body, meta, extra } = cardBody(id);
    return (
      <div key={id} role="button" tabIndex={0} data-nav className={`tvh-card${hero ? " hero" : ""}`} style={{ animationDelay: `${i * 60}ms` }}
        onClick={() => openDetail(id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(id); } }}>
        <div className="tvh-card-head"><span className="tvh-card-title">{TITLES[id]}</span>{meta && <span className="tvh-card-meta">{meta}</span>}</div>
        <div className={`tvh-card-body${id === "brief" ? " fade" : ""}`} data-extra={extra && extra > 0 ? extra : undefined}>
          {body}
          <span className="tvh-more" aria-hidden />
        </div>
      </div>
    );
  });

  // Lists end on a whole row: rows that would be cut are hidden and counted in "+N more".
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const run = () => stage.querySelectorAll<HTMLElement>(".tvh-card-body").forEach(fitBody);
    run();
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  });

  // Focus the first card once there is something to focus.
  useEffect(() => {
    if (!config || detail || pin) return;
    if (!document.activeElement || document.activeElement === document.body) {
      document.querySelector<HTMLElement>(".tvh-stage [data-nav]")?.focus();
    }
  }, [config, cards.length, detail, pin]);

  // Focus the overlay's first control when a detail opens.
  useEffect(() => {
    if (detail) document.querySelector<HTMLElement>(".tvh-detail [data-nav]")?.focus();
  }, [detail]);

  return (
    <div className={`tvh-root${night ? " night" : ""}`}>
      <Screensaver />
      <main ref={stageRef} className="tvh-stage" style={{ opacity: idle ? 0.35 : 1 }} aria-hidden={!!detail || !!pin}>
        {!config ? (
          <div className="tvh-loading">Loading…</div>
        ) : hero ? (
          <div className="tvh-hero">
            <div className="tvh-date">{dateText}</div>
            <div className="tvh-clock big">{clockText}</div>
            <div className="tvh-greet">{greet}</div>
            <div className="tvh-cards-row hero">{cardEls}</div>
            <div className="tvh-actions center">{actions}</div>
          </div>
        ) : (
          <>
            <header className="tvh-top">
              <div>
                <div className="tvh-date">{dateText}</div>
                <div className="tvh-greet top">{greet}</div>
              </div>
              <div className="tvh-top-right">
                <div className="tvh-clock">{clockText}</div>
                <div className="tvh-actions">{actions}</div>
              </div>
            </header>
            <div className="tvh-cards" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
              {cardEls}
            </div>
          </>
        )}
      </main>

      {detail && (
        <div className="tvh-detail-shade" onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
          <div className="tvh-detail" role="dialog" aria-modal="true" aria-label={DETAIL_TITLES[detail]}>
            <div className="tvh-detail-head">
              <span className="tvh-detail-title">{DETAIL_TITLES[detail]}</span>
              <button type="button" className="tvh-ghost" data-nav onClick={closeDetail}>Close</button>
            </div>
            <div className="tvh-detail-body">{detailBody(detail)}</div>
            <div className="tvh-detail-foot">Back or Esc to close</div>
          </div>
        </div>
      )}

      {pin && (
        <PinPad
          overlay
          autoSubmitAt={6}
          scope={pin.scope}
          title={pin.title}
          onCancel={() => setPin(null)}
          onUnlocked={() => { const then = pin.then; setPin(null); void check().then(() => then?.()); }}
        />
      )}

      <div className="tvh-dim" style={{ opacity: Math.max(night ? 0.55 : 0, idle ? 0.55 : 0) }} />
    </div>
  );
}

// ── whole-row fitting for card lists ──────────────────────────────────────

const FIT_SEL = ":scope > .tvh-row, :scope > .tvh-group-h, :scope > [data-fit-item]";

/** Hide every list row that would be cut by the card's bottom edge, and show how many are hidden. */
function fitBody(body: HTMLElement) {
  const items = [...body.querySelectorAll<HTMLElement>(FIT_SEL)];
  const more = body.querySelector<HTMLElement>(":scope > .tvh-more");
  const extra = Number(body.dataset.extra || 0);
  const lineH = parseFloat(getComputedStyle(body).fontSize || "14") * 1.9;
  const out = new Set<HTMLElement>();
  const pass = (limit: number) => {
    out.clear();
    let cut = false, hidden = 0;
    for (const it of items) {
      // offsetTop is layout space (body is the offset parent), so the focus zoom does not skew it.
      if (cut || it.offsetTop + it.offsetHeight > limit + 0.5) {
        cut = true; out.add(it);
        if (!it.classList.contains("tvh-group-h")) hidden++;
      }
    }
    return hidden;
  };
  let hidden = pass(body.clientHeight);
  if (hidden + extra > 0) hidden = pass(body.clientHeight - lineH);
  // A group heading with nothing visible under it goes too.
  items.forEach((it, i) => {
    if (!it.classList.contains("tvh-group-h") || out.has(it)) return;
    const next = items[i + 1];
    if (!next || out.has(next) || next.classList.contains("tvh-group-h")) out.add(it);
  });
  for (const it of items) it.style.visibility = out.has(it) ? "hidden" : "";
  if (more) {
    const n = hidden + extra;
    const text = n > 0 ? `+${n} more` : "";
    if (more.textContent !== text) more.textContent = text;
  }
}

// ── money detail ───────────────────────────────────────────────────────────

function MoneyDetail({ d }: { d: Money }) {
  const m = d.month;
  const groups = d.byCurrency?.length
    ? d.byCurrency
    : [{ currency: d.netWorth.currency, total: d.netWorth.amount, accounts: d.accounts }];
  const top = m.topCategories[0]?.amount || 1;
  const net = m.income - m.spent;
  return (
    <div className="tvh-money">
      {(m.uncategorised ?? 0) > 0 && (
        <div className="tvh-nudge">
          {m.uncategorised} transaction{m.uncategorised === 1 ? "" : "s"} this month {m.uncategorised === 1 ? "has" : "have"} no category · tidy them in Lunch Money so this stays honest
        </div>
      )}
      <div className="tvh-money-cols">
        <section className="tvh-section">
          <h3>Net worth</h3>
          <div className="tvh-money-big">{money(d.netWorth.amount, d.netWorth.currency, true)}</div>
          {groups.map((g) => (
            <div key={g.currency} className="tvh-money-group">
              <div className="tvh-money-cat head"><span>{g.currency}</span><span>{money(g.total, g.currency, true)}</span></div>
              {g.accounts.map((a, i) => (
                <div key={`${a.name}${i}`} className="tvh-acct">
                  <span className="tvh-acct-name">
                    <span>{a.name}</span>
                    {a.institution && <span className="tvh-faint">{a.institution}</span>}
                  </span>
                  <span className={a.liability ? "tvh-bad" : ""}>{a.liability ? "−" : ""}{money(Math.abs(a.balance), a.currency, true)}</span>
                </div>
              ))}
            </div>
          ))}
        </section>
        <section className="tvh-section">
          <h3>This month</h3>
          <div className="tvh-stat3">
            <span><small>Spent</small>{money(m.spent, m.currency, true)}</span>
            <span><small>In</small>{money(m.income, m.currency, true)}</span>
            <span className={net < 0 ? "tvh-bad" : "tvh-good"}><small>Net</small>{net < 0 ? "−" : "+"}{money(Math.abs(net), m.currency, true)}</span>
          </div>
          {m.topCategories.map((c) => (
            <div key={c.name} className="tvh-money-cat">
              <span className="tvh-muted">{c.name}</span><span>{money(Math.abs(c.amount), m.currency, true)}</span>
              <i className="tvh-catbar" style={{ width: `${Math.max(3, (Math.abs(c.amount) / top) * 100)}%` }} />
            </div>
          ))}
          {(m.largest?.length ?? 0) > 0 && (
            <>
              <h3 className="gap">Largest</h3>
              {m.largest!.map((t, i) => (
                <div key={i} className="tvh-tx">
                  <span className="tvh-tx-name"><span>{t.payee}</span><span className="tvh-faint">{[dateOnlyLabel(t.date), t.category].filter(Boolean).join(" · ")}</span></span>
                  <span>{money(Math.abs(t.amount), t.currency, false)}</span>
                </div>
              ))}
            </>
          )}
        </section>
        <section className="tvh-section">
          {(d.upcoming?.length ?? 0) > 0 && (
            <>
              <h3>Coming out</h3>
              {d.upcoming!.map((u, i) => (
                <div key={i} className="tvh-tx">
                  <span className="tvh-tx-name"><span>{u.payee}</span><span className="tvh-faint">{dateOnlyLabel(u.date)}</span></span>
                  <span>{money(Math.abs(u.amount), u.currency, false)}</span>
                </div>
              ))}
              <h3 className="gap">Recent</h3>
            </>
          )}
          {!(d.upcoming?.length) && <h3>Recent</h3>}
          {d.recent.map((t, i) => (
            <div key={i} className="tvh-tx">
              <span className="tvh-tx-name"><span>{t.payee}</span><span className="tvh-faint">{[dateOnlyLabel(t.date), t.category].filter(Boolean).join(" · ")}</span></span>
              <span className={t.amount > 0 ? "tvh-good" : ""}>{t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount), t.currency, false)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

// ── arrow-key focus (spatial navigation) ──────────────────────────────────

type Dir = "up" | "down" | "left" | "right";

function moveFocus(dir: Dir) {
  const scope = document.querySelector(".pin-overlay") ?? document.querySelector(".tvh-detail") ?? document.querySelector(".tvh-stage");
  if (!scope) return;
  const sel = scope.classList.contains("pin-overlay") ? "button:not(:disabled)" : "[data-nav]";
  const els = [...scope.querySelectorAll<HTMLElement>(sel)].filter((e) => e.offsetParent !== null);
  if (!els.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !els.includes(cur)) { els[0].focus(); return; }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const e of els) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect();
    const ex = b.left + b.width / 2, ey = b.top + b.height / 2;
    const dx = ex - cx, dy = ey - cy;
    const main = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (main <= 1) continue;
    const cross = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = main + cross * 2;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: "nearest" }); }
}
