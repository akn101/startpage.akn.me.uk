"use client";

import { ReactNode, useState } from "react";
import PinPad from "./tv/PinPad";

/**
 * Wrap a widget that shows sensitive data (bonds, finance…). The widget's API
 * route calls requireSensitive(); when it answers 423 the widget sets
 * `locked` and this shows a PIN prompt instead. On unlock it calls onUnlocked
 * so the widget can refetch. The unlock lasts a few minutes, then relocks.
 *
 *   <PinGate locked={status === 423} onUnlocked={refetch}>…data…</PinGate>
 */
export default function PinGate({
  locked,
  onUnlocked,
  label = "Private — enter PIN",
  children,
}: {
  locked: boolean;
  onUnlocked: () => void;
  label?: string;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (!locked) return <>{children}</>;
  if (!asking) {
    return (
      <button type="button" className="pin-gate-btn glass" onClick={() => setAsking(true)}>
        🔒 {label}
      </button>
    );
  }
  return (
    <PinPad
      scope="sensitive"
      onUnlocked={() => { setAsking(false); onUnlocked(); }}
      onCancel={() => setAsking(false)}
    />
  );
}

/** fetch() helper: returns { status, data }, so callers can spot 423. */
export async function fetchSensitive<T>(url: string): Promise<{ status: number; data: T | null }> {
  const r = await fetch(url, { cache: "no-store" });
  return { status: r.status, data: r.ok ? ((await r.json()) as T) : null };
}
