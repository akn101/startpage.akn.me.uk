"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  scope: "private" | "sensitive";
  title?: string;
  onUnlocked: () => void;
  onCancel?: () => void;
  /** Full-screen overlay (TV lock) or inline card (PinGate). */
  overlay?: boolean;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
const MAX = 12;

/** Remote-friendly PIN pad: arrows + OK on the grid, or number keys directly. */
export default function PinPad({ scope, title, onUnlocked, onCancel, overlay }: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const locked = !!lockedUntil && lockedUntil > now;

  const submit = useCallback(async (value: string) => {
    if (busy || locked || value.length < 6) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/lock/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value, scope }),
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) return onUnlocked();
      setPin("");
      if (r.status === 429 && d.lockedUntil) {
        setLockedUntil(d.lockedUntil);
        setNow(Date.now());
      } else if (r.status === 503) setMsg("No PIN set up yet. Run scripts/set-pin.mjs.");
      else if (r.status === 401 && typeof d.remaining === "number")
        setMsg(`Wrong PIN. ${d.remaining} ${d.remaining === 1 ? "try" : "tries"} left.`);
      else if (r.status === 401) setMsg("Signed out. Sign in again.");
      else setMsg("Couldn't check the PIN. Try again.");
    } catch {
      setMsg("Offline. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, locked, scope, onUnlocked]);

  const press = useCallback((k: string) => {
    if (locked) return;
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    if (k === "OK") return void submit(pin);
    setPin((p) => (p.length < MAX ? p + k : p));
  }, [locked, pin, submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); press("⌫"); }
      else if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, onCancel]);

  const wait = locked ? Math.ceil((lockedUntil! - now) / 1000) : 0;
  const waitText = wait > 90 ? `${Math.ceil(wait / 60)} min` : `${wait}s`;

  return (
    <div className={overlay ? "pin-overlay" : "pin-inline"} role="dialog" aria-modal={overlay} aria-label="Enter PIN">
      <div className="pin-card glass">
        <div className="pin-title">{title ?? (scope === "sensitive" ? "PIN for private data" : "Locked")}</div>
        <div className="pin-dots" aria-live="polite" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(6, pin.length) }).map((_, i) => (
            <span key={i} className={i < pin.length ? "on" : ""} />
          ))}
        </div>
        <div className="pin-msg" role="status">
          {locked ? `Too many wrong PINs. Try again in ${waitText}.` : busy ? "Checking…" : msg ?? " "}
        </div>
        <div className="pin-grid">
          {KEYS.map((k, i) => (
            <button
              key={k}
              ref={i === 0 ? first : undefined}
              type="button"
              className={`pin-key${k === "OK" ? " ok" : ""}`}
              disabled={locked || busy || (k === "OK" && pin.length < 6)}
              aria-label={k === "⌫" ? "Delete" : k === "OK" ? "Unlock" : k}
              onClick={() => press(k)}
            >
              {k}
            </button>
          ))}
        </div>
        {onCancel && (
          <button type="button" className="pin-cancel" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </div>
  );
}
