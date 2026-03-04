"use client";

import {
  createContext, useCallback, useContext,
  useEffect, useRef, useState, ReactNode,
} from "react";

export interface TrackerSession {
  id: string;
  label: string;
  duration_s: number;
}

export interface ActiveTimer {
  id: string;
  label: string;
  startedAt: Date;
  elapsed: number;
}

interface TimeTrackerCtx {
  timers: ActiveTimer[];
  sessions: TrackerSession[];
  start: (label: string) => void;
  stop: (id: string) => Promise<void>;
  stopAll: () => Promise<void>;
  running: boolean;
  label: string;
  elapsed: number;
}

const Ctx = createContext<TimeTrackerCtx | null>(null);

export function useTimeTracker() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTimeTracker outside provider");
  return ctx;
}

export function fmtDuration(s: number) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

interface ProjectKeywords { name: string; keywords: string }

/** Return best-matching project name for a timer label, or null */
function matchProject(label: string, projects: ProjectKeywords[]): string | null {
  const lc = label.toLowerCase();
  for (const p of projects) {
    const terms = [p.name, ...p.keywords.split(/[\s,]+/)].map((t) => t.toLowerCase()).filter(Boolean);
    if (terms.some((t) => t.length > 2 && lc.includes(t))) return p.name;
  }
  return null;
}

export function TimeTrackerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers]     = useState<ActiveTimer[]>([]);
  const [sessions, setSessions] = useState<TrackerSession[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const projectsRef = useRef<ProjectKeywords[]>([]);

  useEffect(() => {
    fetch("/api/data/sessions")
      .then((r) => r.json())
      .then(({ sessions: data }) => { if (data) setSessions(data); });
    // Load project keywords for timer matching
    fetch("/api/tasks")
      .then((r) => r.json())
      .then(({ projects }) => { if (projects) projectsRef.current = projects; });
  }, []);

  useEffect(() => {
    if (timers.length === 0) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    if (!intervalRef.current) {
      intervalRef.current = setInterval(() => {
        setTimers((prev) =>
          prev.map((t) => ({ ...t, elapsed: Math.floor((Date.now() - t.startedAt.getTime()) / 1000) }))
        );
      }, 1000);
    }
  }, [timers.length]);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const saveSession = useCallback((timer: ActiveTimer, endedAt: Date) => {
    const duration_s = Math.floor((endedAt.getTime() - timer.startedAt.getTime()) / 1000);
    const project = matchProject(timer.label, projectsRef.current);
    fetch("/api/data/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: timer.label,
        started_at: timer.startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_s,
        ...(project ? { project } : {}),
      }),
    })
      .then((r) => r.json())
      .then(({ session }) => { if (session) setSessions((s) => [session, ...s].slice(0, 5)); });
  }, []);

  const start = useCallback((label: string) => {
    const l = label.trim();
    if (!l) return;
    setTimers((prev) => [...prev, { id: crypto.randomUUID(), label: l, startedAt: new Date(), elapsed: 0 }]);
  }, []);

  const stop = useCallback(async (id: string) => {
    const endedAt = new Date();
    setTimers((prev) => {
      const timer = prev.find((t) => t.id === id);
      if (timer) saveSession(timer, endedAt);
      return prev.filter((t) => t.id !== id);
    });
  }, [saveSession]);

  const stopAll = useCallback(async () => {
    const endedAt = new Date();
    setTimers((prev) => { prev.forEach((t) => saveSession(t, endedAt)); return []; });
  }, [saveSession]);

  const running = timers.length > 0;
  const label   = timers.map((t) => t.label).join(", ");
  const elapsed = timers.length > 0 ? Math.max(...timers.map((t) => t.elapsed)) : 0;

  return (
    <Ctx.Provider value={{ timers, sessions, start, stop, stopAll, running, label, elapsed }}>
      {children}
    </Ctx.Provider>
  );
}
