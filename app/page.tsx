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

type DimLevel = 0 | 25 | 50 | 75 | 90;

function useDim() {
  const [autoDim, setAutoDim] = useState(false);
  const [manualDim, setManualDim] = useState<DimLevel>(0);

  useEffect(() => {
    // Restore manual dim from localStorage
    const saved = localStorage.getItem("sp_dim");
    if (saved) setManualDim(Number(saved) as DimLevel);
  }, []);

  useEffect(() => {
    const check = () => { const h = new Date().getHours(); setAutoDim(h >= 22 || h < 6); };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  // Listen for dim events from CommandPalette
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showMini, setShowMini] = useState(false);

  // Auto-refresh data every 30 min + reload on new deployment after 10 min idle
  useEffect(() => {
    let deploymentId: string | null = null;
    let lastActivity = Date.now();
    const IDLE_MS = 10 * 60 * 1000;

    // Track user activity
    const onActivity = () => { lastActivity = Date.now(); };
    ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true })
    );

    // Fetch current deployment ID on mount
    fetch("/api/version").then((r) => r.json()).then((d) => { deploymentId = d.id; });

    const id = setInterval(async () => {
      // Dispatch data refresh
      window.dispatchEvent(new CustomEvent("refreshData"));

      // Check for new deployment
      try {
        const { id: latestId } = await fetch("/api/version").then((r) => r.json());
        const idle = Date.now() - lastActivity > IDLE_MS;
        if (deploymentId && latestId !== deploymentId && idle) {
          window.location.reload();
        }
      } catch { /* ignore */ }
    }, 30 * 60 * 1000);

    return () => {
      clearInterval(id);
      ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((e) =>
        window.removeEventListener(e, onActivity)
      );
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowMini(el.scrollTop > window.innerHeight * 0.4);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const handleAddTodo = useCallback((text: string) => {
    setPendingTodo(text);
    setTimeout(() => setPendingTodo(null), 100);
  }, []);

  const dimOverlayClass = [
    "dim-overlay",
    autoDim && !manualDim ? "is-dim" : "",
    manualDim ? `dim-${manualDim}` : "",
  ].filter(Boolean).join(" ");

  const screensaverClass = manualDim ? `screensaver-dim screensaver-dim-${manualDim}` : "";

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
            <SearchBar />
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
              <ProjectTracker />
              <GitHubPRs />
              <CalendarWidget />
              <PhotoSlideshow />
              <RecentVisitors />
            </div>
          </section>

        </div>

        {/* ── Background camera monitor (auth-gated, invisible) ── */}
        <CameraMonitor />

        {/* ── cmd+k palette ── */}
        <CommandPalette onAddTodo={handleAddTodo} />

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
        <div className="kbd-hint">⌘K · /record · /alarm · /dim</div>
      </main>
    </TimeTrackerProvider>
  );
}
