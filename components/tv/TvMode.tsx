"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PinPad from "./PinPad";

const IDLE_LOCK_MS = 3 * 60_000; // relock the TV after 3 min without a key press
const TOUCH_MS = 5 * 60_000; // keep the unlock alive while in use
const VERSION_POLL_MS = 20_000; // hot reload: pick up a new deploy within ~20s

type LockState = {
  signedIn: boolean;
  device?: "tv" | "browser";
  unlocked?: { private: boolean; sensitive: boolean };
};

const isTv = () => typeof navigator !== "undefined" && navigator.userAgent.includes("StartpageTV");

/**
 * Mounted once in the root layout. Does nothing outside the TV app.
 * In the TV app: no service worker / caches, a full-screen PIN pad while the
 * session is locked, relock on idle, and reload when a new deploy goes live.
 */
export default function TvMode() {
  const [tv, setTv] = useState(false);
  const [locked, setLocked] = useState(false);
  const lastKey = useRef(Date.now());
  const version = useRef<string | null>(null);

  const relock = useCallback(async () => {
    await fetch("/api/lock/lock", { method: "POST", cache: "no-store" }).catch(() => {});
    window.location.reload();
  }, []);

  // Detect TV, drop offline caches (private data must not sit on the TV's disk).
  useEffect(() => {
    if (!isTv()) return;
    // The music player page manages itself: no idle relock/reload mid-song.
    if (window.location.pathname.startsWith("/tv/music")) return;
    setTv(true);
    document.documentElement.classList.add("tv");
    navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if ("caches" in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }, []);

  // Lock state.
  useEffect(() => {
    if (!tv) return;
    fetch("/api/lock/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: LockState) => setLocked(!!d.signedIn && d.device === "tv" && !d.unlocked?.private))
      .catch(() => {});
  }, [tv]);

  // Idle relock + keep-alive touch.
  useEffect(() => {
    if (!tv || locked) return;
    const bump = () => { lastKey.current = Date.now(); };
    window.addEventListener("keydown", bump, true);
    window.addEventListener("pointerdown", bump, true);
    const idle = setInterval(() => {
      if (Date.now() - lastKey.current > IDLE_LOCK_MS) void relock();
    }, 15_000);
    const touch = setInterval(() => {
      if (Date.now() - lastKey.current < TOUCH_MS) {
        fetch("/api/lock/touch", { method: "POST", cache: "no-store" })
          .then((r) => { if (r.status === 423) window.location.reload(); })
          .catch(() => {});
      }
    }, TOUCH_MS);
    return () => {
      window.removeEventListener("keydown", bump, true);
      window.removeEventListener("pointerdown", bump, true);
      clearInterval(idle);
      clearInterval(touch);
    };
  }, [tv, locked, relock]);

  // Leaving the TV app (home button, input switch) relocks at once; coming
  // back reloads so the PIN pad shows. Works in any engine, no app hook needed.
  useEffect(() => {
    if (!tv) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (!navigator.sendBeacon?.("/api/lock/lock")) {
          fetch("/api/lock/lock", { method: "POST", keepalive: true, cache: "no-store" }).catch(() => {});
        }
      } else if (!locked) {
        window.location.reload();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [tv, locked]);

  // Hot reload on new deploy (dev servers hot-reload by themselves).
  useEffect(() => {
    if (!tv) return;
    const check = async () => {
      try {
        const { id } = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json());
        if (!id || id === "dev") return;
        if (version.current && version.current !== id) window.location.reload();
        version.current = id;
      } catch { /* offline */ }
    };
    void check();
    const t = setInterval(check, VERSION_POLL_MS);
    return () => clearInterval(t);
  }, [tv]);

  if (!tv || !locked) return null;
  return <PinPad scope="private" overlay title="Enter PIN to unlock" onUnlocked={() => window.location.reload()} />;
}
