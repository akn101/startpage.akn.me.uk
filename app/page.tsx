"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useNotifications } from "@/hooks/useNotifications";
import NotificationToast from "@/components/NotificationToast";
import { TimeTrackerProvider } from "@/context/TimeTrackerContext";

const Screensaver    = dynamic(() => import("@/components/Screensaver"),    { ssr: false });
const Clock          = dynamic(() => import("@/components/Clock"),          { ssr: false });
const Weather        = dynamic(() => import("@/components/Weather"),        { ssr: false });
const QuickLinks     = dynamic(() => import("@/components/QuickLinks"),     { ssr: false });
const Todos          = dynamic(() => import("@/components/Todos"),          { ssr: false });
const TimeTracker    = dynamic(() => import("@/components/TimeTracker"),    { ssr: false });
const SearchBar      = dynamic(() => import("@/components/SearchBar"),      { ssr: false });
const GitHubPRs      = dynamic(() => import("@/components/GitHubPRs"),     { ssr: false });
const NotionTasks    = dynamic(() => import("@/components/NotionTasks"),    { ssr: false });
const CommandPalette = dynamic(() => import("@/components/CommandPalette"), { ssr: false });
const Alarm          = dynamic(() => import("@/components/Alarm"),          { ssr: false });
const PhotoSlideshow = dynamic(() => import("@/components/PhotoSlideshow"), { ssr: false });
const CalendarWidget   = dynamic(() => import("@/components/CalendarWidget"),   { ssr: false });
const ProjectTracker   = dynamic(() => import("@/components/ProjectTracker"),   { ssr: false });
const CameraMonitor    = dynamic(() => import("@/components/CameraMonitor"),    { ssr: false });
const RecentVisitors   = dynamic(() => import("@/components/RecentVisitors"),   { ssr: false });
const MiniClock        = dynamic(() => import("@/components/MiniClock"),         { ssr: false });
const Assignments      = dynamic(() => import("@/components/Assignments"),       { ssr: false });
const HackerNews       = dynamic(() => import("@/components/HackerNews"),        { ssr: false });
const ThoughtsFeed     = dynamic(() => import("@/components/ThoughtsFeed"),      { ssr: false });
const DisplayShell     = dynamic(() => import("@/components/display/DisplayShell"), { ssr: false });

type DimLevel = 0 | 25 | 50 | 75 | 90;

function useDim() {
  const [autoDim, setAutoDim] = useState(false);
  const [manualDim, setManualDim] = useState<DimLevel | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("sp_dim");
    if (saved !== null) setManualDim(Number(saved) as DimLevel);
  }, []);

  useEffect(() => {
    const check = () => { const h = new Date().getHours(); setAutoDim(h >= 22 || h < 6); };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const level = (e as CustomEvent<DimLevel>).detail;
      setManualDim(level);
      localStorage.setItem("sp_dim", String(level));
    };
    window.addEventListener("setDim", handler);
    return () => window.removeEventListener("setDim", handler);
  }, []);

  return { autoDim, manualDim };
}

export default function Page() {
  const { toasts, dismiss } = useNotifications();
  const { autoDim, manualDim } = useDim();
  const [pendingTodo, setPendingTodo] = useState<string | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showMini, setShowMini] = useState(false);

  // Camera enabled state — persisted to localStorage
  const [cameraEnabled, setCameraEnabled] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("sp_camera");
    if (saved === "off") setCameraEnabled(false);
  }, []);

  const handleCameraToggle = useCallback(() => {
    setCameraEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("sp_camera", next ? "on" : "off");
      return next;
    });
  }, []);

  // Shared activity tracker (used by idle-scroll and deployment-reload)
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    const onActivity = () => { lastActivityRef.current = Date.now(); };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    return () => events.forEach((ev) => window.removeEventListener(ev, onActivity));
  }, []);

  // Hide display mode on mouse movement or Escape key
  useEffect(() => {
    const hide = () => setShowDisplay(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowDisplay(false); };
    window.addEventListener("mousemove", hide, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", hide);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Show display mode after idle (threshold configurable via sp_display_idle localStorage, default 10 min)
  useEffect(() => {
    const raw = typeof window !== "undefined" ? localStorage.getItem("sp_display_idle") : null;
    const DISPLAY_IDLE_MS = raw ? Number(raw) * 60_000 : 10 * 60 * 1000;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current > DISPLAY_IDLE_MS) setShowDisplay(true);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-refresh data every 30 min + reload on new deployment after 10 min idle
  useEffect(() => {
    let deploymentId: string | null = null;
    const IDLE_MS = 10 * 60 * 1000;

    fetch("/api/version").then((r) => r.json()).then((d) => { deploymentId = d.id; });

    const id = setInterval(async () => {
      window.dispatchEvent(new CustomEvent("refreshData"));
      try {
        const { id: latestId } = await fetch("/api/version").then((r) => r.json());
        const idle = Date.now() - lastActivityRef.current > IDLE_MS;
        if (deploymentId && latestId !== deploymentId && idle) {
          window.location.reload();
        }
      } catch { /* ignore */ }
    }, 30 * 60 * 1000);

    return () => clearInterval(id);
  }, []);

  // Idle scroll-home: after 1 min of no activity, snap back to section 1
  useEffect(() => {
    const id = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current > 60_000;
      if (idle && scrollRef.current && scrollRef.current.scrollTop > 0) {
        scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  // Global keydown: any printable character opens cmd+k prefilled with that char
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag     = (document.activeElement as HTMLElement)?.tagName ?? "";
      const inInput = ["INPUT", "TEXTAREA"].includes(tag);
      if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("openCommandPalette", { detail: { prefill: e.key } })
        );
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowMini(el.scrollTop > window.innerHeight * 0.4);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Animate sections when they snap into view
  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>(".snap-section");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove("is-visible");
            // Force reflow so re-entering a section replays the animation
            void (entry.target as HTMLElement).offsetWidth;
            entry.target.classList.add("is-visible");
          } else {
            entry.target.classList.remove("is-visible");
          }
        });
      },
      { threshold: 0.5 }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const handleAddTodo = useCallback((text: string) => {
    setPendingTodo(text);
    setTimeout(() => setPendingTodo(null), 100);
  }, []);

  const dimOverlayClass = [
    "dim-overlay",
    autoDim && manualDim === null ? "is-dim" : "",
    manualDim != null && manualDim > 0 ? `dim-${manualDim}` : "",
  ].filter(Boolean).join(" ");

  const screensaverClass = manualDim != null && manualDim > 0 ? `screensaver-dim screensaver-dim-${manualDim}` : "";

  return (
    <TimeTrackerProvider>
      <main>
        {/* ── Always-on animated background (fixed) ── */}
        <div className={screensaverClass}>
          <Screensaver />
        </div>

        {/* ── Dim overlay ── */}
        <div className={dimOverlayClass} />

        {/* ── Fixed mini-clock ── */}
        <div className={`mini-clock-wrap${showMini ? " visible" : ""}`}>
          <MiniClock />
        </div>

        {/* ── Snap scroll container ── */}
        <div className="snap-container" ref={scrollRef}>

          {/* Section 1: Landing — big clock + search */}
          <section className="snap-section section-landing">
            <Clock />
            <SearchBar autoFocus />
          </section>

          {/* Section 2: Dashboard — compact clock + widgets + links */}
          <section className="snap-section section-dashboard">
            <Clock />
            <SearchBar />
            <div className="widget-row">
              <Weather />
              <Todos externalAdd={pendingTodo} />
              <TimeTracker />
              <Alarm />
            </div>
            <QuickLinks />
          </section>

          {/* Section 3: Feed tiles */}
          <section className="snap-section section-feed">
            <div className="feed-section">
              <Assignments />
              <ProjectTracker />
              <GitHubPRs />
              <HackerNews />
              <CalendarWidget />
              <PhotoSlideshow />
              <RecentVisitors />
              <ThoughtsFeed />
            </div>
          </section>

          {/* Section 4: Display mode — TRMNL-style glanceable panel */}
          <section className="snap-section section-display">
            <DisplayShell inline />
          </section>

        </div>

        {/* ── Background camera monitor (auth-gated, invisible) ── */}
        <CameraMonitor enabled={cameraEnabled} />

        {/* ── cmd+k palette ── */}
        <CommandPalette
          onAddTodo={handleAddTodo}
          cameraEnabled={cameraEnabled}
          onCameraToggle={handleCameraToggle}
        />

        {/* ── Android FAB ── */}
        <button
          type="button"
          className="fab-cmdk"
          aria-label="Open command palette"
          onClick={() => window.dispatchEvent(new CustomEvent("openCommandPalette"))}
        >
          ⌘
        </button>

        {/* ── Toasts ── */}
        <NotificationToast toasts={toasts} onDismiss={dismiss} />

        {/* ── Keyboard hint ── */}
        <div className="kbd-hint">⌘K · /record · /alarm · /dim · /camera · /display</div>

        {/* ── Idle display mode overlay ── */}
        {showDisplay && (
          <div className="display-overlay">
            <button
              type="button"
              className="display-close-btn"
              onClick={() => setShowDisplay(false)}
              aria-label="Close display mode"
            >
              ×
            </button>
            <DisplayShell />
          </div>
        )}
      </main>
    </TimeTrackerProvider>
  );
}
