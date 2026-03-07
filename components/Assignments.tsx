"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTimeTracker } from "@/context/TimeTrackerContext";

interface Assignment {
  id: string;
  url: string;
  title: string;
  status: string;
  due: string | null;
  subject: string;
  duration: number | null;
}

// Cycle: Not Started → In Progress → Complete
const STATUS_NEXT: Record<string, string> = {
  "Not Started": "In Progress",
  "In Progress": "Complete",
  "Complete":    "Not Started",
};
const STATUS_CLASS: Record<string, string> = {
  "Not Started": "assign-status-todo",
  "In Progress": "assign-status-progress",
  "Complete":    "assign-status-done",
};

function fmtEstimate(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}
function fmtDue(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function Assignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const { authenticated } = useAuth();
  const { start } = useTimeTracker();

  const load = () => {
    fetch("/api/assignments")
      .then((r) => r.json())
      .then((d) => { setAssignments(d.assignments ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    window.addEventListener("refreshData", load);
    return () => window.removeEventListener("refreshData", load);
  }, []); // eslint-disable-line

  const cycleStatus = async (id: string, current: string) => {
    if (!authenticated) return;
    const next = STATUS_NEXT[current] ?? "In Progress";
    setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, status: next } : a));
    if (next === "Complete") {
      setTimeout(() => setAssignments((prev) => prev.filter((a) => a.id !== id)), 1200);
    }
    await fetch("/api/assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    });
  };

  return (
    <div className="feed-widget glass-sm assignments-widget">
      <div className="feed-widget-header">Assignments</div>

      {loading && <div className="feed-empty">loading…</div>}
      {!loading && assignments.length === 0 && (
        <div className="feed-empty">no pending assignments</div>
      )}

      <div className="assignments-list">
        {assignments.map((a) => {
          const days    = a.due ? daysUntil(a.due) : null;
          const overdue = days !== null && days < 0;
          const urgent  = days !== null && days >= 0 && days <= 2;

          return (
            <div key={a.id} className={`assignment-item${overdue ? " overdue" : ""}`}>
              <button
                type="button"
                className={`assign-status-btn ${STATUS_CLASS[a.status] ?? "assign-status-todo"}`}
                onClick={() => cycleStatus(a.id, a.status)}
                title={`${a.status} — click to advance`}
              >
                {a.status || "?"}
              </button>
              <span className="assign-body">
                <span className="assign-title-row">
                  <a href={a.url} target="_blank" rel="noreferrer" className="assign-title">{a.title}</a>
                  <button type="button" className="assign-timer-btn" title="Start timer" onClick={() => start(`Eton – ${a.title}`)}>▶</button>
                </span>
                <span className="assign-meta">
                  {a.subject && <span className="assign-subject">{a.subject}</span>}
                  {a.due && (
                    <span className={`assign-due${overdue ? " overdue" : urgent ? " urgent" : ""}`}>
                      {overdue
                        ? `${Math.abs(days!)}d overdue`
                        : days === 0
                          ? "due today"
                          : fmtDue(a.due)}
                    </span>
                  )}
                  {a.duration != null && <span className="assign-duration">{fmtEstimate(a.duration)}</span>}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
