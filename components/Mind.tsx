"use client";

import { useCallback, useEffect, useState } from "react";
import PinGate, { fetchSensitive } from "./PinGate";
import { parseWhen } from "@/lib/when";

type Kind = "wish" | "thought" | "reminder";
type Item = { id: string; kind: Kind; text: string; person: string | null; due_at: string | null; done: boolean };
type Bonds = {
  tasks: { id: number; label: string; due_at: string | null; people: string[] }[];
  reminders: { id: number; label: string; person: string; next: string | null }[];
  error?: string;
} | null;

const KIND_LABEL: Record<Kind, string> = { wish: "Wants for you", thought: "On my mind", reminder: "Reminders" };

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * Wants people have for you, things on your mind, reminders, and live Bonds
 * tasks/reminders. Sensitive: needs a fresh PIN on every device.
 * The `/remind` and `/mind` palette commands dispatch "mindAdd".
 */
export default function Mind() {
  const [status, setStatus] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [bonds, setBonds] = useState<Bonds>(null);
  const [kind, setKind] = useState<Kind>("reminder");
  const [text, setText] = useState("");
  const [person, setPerson] = useState("");
  const [err, setErr] = useState("");
  const [brief, setBrief] = useState<{ text: string; ai: boolean } | null>(null);
  const [briefing, setBriefing] = useState(false);

  const getBrief = useCallback(async () => {
    setBriefing(true);
    const r = await fetchSensitive<{ text: string; ai: boolean }>("/api/brief");
    setBriefing(false);
    if (r.status === 423) { setStatus(423); return; }
    if (r.data) setBrief(r.data); else setErr(`Brief failed (${r.status})`);
  }, []);

  // `/brief` in the palette
  useEffect(() => {
    const on = () => { document.querySelector(".mind-widget")?.scrollIntoView({ behavior: "smooth", block: "center" }); getBrief(); };
    window.addEventListener("mindBrief", on);
    return () => window.removeEventListener("mindBrief", on);
  }, [getBrief]);

  const load = useCallback(async () => {
    const r = await fetchSensitive<{ items: Item[]; bonds: Bonds }>("/api/mind");
    setStatus(r.status);
    if (r.data) { setItems(r.data.items); setBonds(r.data.bonds); }
  }, []);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("refreshData", onRefresh);
    window.addEventListener("mindChanged", onRefresh);
    return () => { window.removeEventListener("refreshData", onRefresh); window.removeEventListener("mindChanged", onRefresh); };
  }, [load]);

  // The sensitive unlock lasts 3 minutes; hide the data again when it lapses.
  useEffect(() => {
    if (status !== 200) return;
    const t = setTimeout(() => { setItems([]); setBonds(null); setBrief(null); setStatus(423); }, 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, [status]);

  const send = async (method: string, body: object) => {
    const r = await fetch("/api/mind", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 423) { setStatus(423); return false; }
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? `Error ${r.status}`); return false; }
    setErr("");
    await load();
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await send("POST", { kind, text, person: kind === "wish" ? person : undefined })) { setText(""); setPerson(""); }
  };

  const preview = kind === "reminder" && text ? parseWhen(text).due : null;
  const now = Date.now();
  const byKind = (k: Kind) => items.filter((i) => i.kind === k);

  return (
    <div className="mind-widget glass-sm">
      <div className="mind-header">
        <span>🧠 Mind</span>
        {status === 200 && (
          <button type="button" className="mind-brief-btn" onClick={getBrief} disabled={briefing} title="Morning brief">
            {briefing ? "…" : "☀️ Brief me"}
          </button>
        )}
      </div>
      {brief && status === 200 && (
        <div className="mind-brief">
          <pre>{brief.text}</pre>
          <small>{brief.ai ? "Written by Claude from your data" : "Plain summary (AI unavailable)"} · <button type="button" onClick={() => setBrief(null)}>hide</button></small>
        </div>
      )}
      <PinGate locked={status === 423} onUnlocked={load} label="Mind is private — enter PIN">
        {status === 401 ? <p className="mind-empty">Sign in to see this.</p> : status === 0 ? <p className="mind-empty">Loading…</p> : (
          <>
            <form className="mind-add" onSubmit={add}>
              <div className="mind-kinds" role="tablist">
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={kind === k}
                    className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
                    {k === "wish" ? "Wish" : k === "thought" ? "Thought" : "Remind"}
                  </button>
                ))}
              </div>
              {kind === "wish" && (
                <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Who (e.g. Lyra)" maxLength={200} />
              )}
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
                placeholder={kind === "wish" ? "wants me to… (be more relaxed)" : kind === "thought" ? "What's on your mind" : "journal tomorrow"} />
              {preview && <span className="mind-preview">⏰ {fmtDue(preview.toISOString())}</span>}
              <button type="submit" disabled={!text.trim()}>Add</button>
            </form>
            {err && <p className="mind-error">{err}</p>}

            {(["reminder", "wish", "thought"] as Kind[]).map((k) => {
              const list = byKind(k);
              if (!list.length) return null;
              return (
                <section key={k} className="mind-section">
                  <h4>{KIND_LABEL[k]}</h4>
                  <ul>
                    {list.map((i) => {
                      const overdue = !!i.due_at && new Date(i.due_at).getTime() < now;
                      return (
                        <li key={i.id} className={overdue ? "overdue" : ""}>
                          <button type="button" className="mind-check" title="Done" aria-label="Mark done"
                            onClick={() => send("PATCH", { id: i.id, done: true })}>○</button>
                          <span className="mind-text">
                            {i.person && <b>{i.person}: </b>}{i.text}
                            {i.due_at && <em> · {fmtDue(i.due_at)}</em>}
                          </span>
                          <button type="button" className="mind-del" title="Delete" aria-label="Delete"
                            onClick={() => send("DELETE", { id: i.id })}>×</button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}

            {bonds && (bonds.tasks.length > 0 || bonds.reminders.length > 0 || bonds.error) && (
              <section className="mind-section mind-bonds">
                <h4>From Bonds</h4>
                {bonds.error && <p className="mind-error">Bonds unavailable</p>}
                <ul>
                  {bonds.reminders.map((r) => (
                    <li key={`r${r.id}`}><span className="mind-text">🎂 <b>{r.person}</b> — {r.label}{r.next && <em> · {r.next}</em>}</span></li>
                  ))}
                  {bonds.tasks.map((t) => (
                    <li key={`t${t.id}`}><span className="mind-text">☐ {t.label}{t.people.length > 0 && <> ({t.people.join(", ")})</>}{t.due_at && <em> · {t.due_at.slice(0, 10)}</em>}</span></li>
                  ))}
                </ul>
              </section>
            )}

            {items.length === 0 && !bonds?.tasks.length && !bonds?.reminders.length && (
              <p className="mind-empty">Nothing yet. Try “journal tomorrow”, or a wish: Lyra — be more relaxed.</p>
            )}
          </>
        )}
      </PinGate>
    </div>
  );
}
