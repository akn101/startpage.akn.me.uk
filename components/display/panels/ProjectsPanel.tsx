"use client";

import { useState, useEffect } from "react";

interface NotionTask {
  id: string;
  title: string;
  status: string;
  project: string;
}

interface NotionProject {
  id: string;
  name: string;
  status: string;
}

interface Session {
  project: string | null;
  duration_s: number;
  started_at: string;
}

function weekStart(): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}

export default function ProjectsPanel() {
  const [projects, setProjects] = useState<NotionProject[]>([]);
  const [tasks, setTasks] = useState<NotionTask[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [updated, setUpdated] = useState(new Date());

  const load = async () => {
    const [t, s] = await Promise.allSettled([
      fetch("/api/tasks").then((r) => r.json()),
      fetch("/api/data/sessions").then((r) => r.json()),
    ]);
    if (t.status === "fulfilled") {
      const raw = t.value;
      // Handle both flat array and { projects, tasks } shape
      if (Array.isArray(raw)) {
        setProjects(raw);
        setTasks([]);
      } else {
        setProjects(raw.projects ?? []);
        setTasks(raw.tasks ?? []);
      }
    }
    if (s.status === "fulfilled") {
      const raw = s.value;
      setSessions(Array.isArray(raw) ? raw : (raw.sessions ?? []));
    }
    setUpdated(new Date());
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ws = weekStart();
  const weekSessions = sessions.filter((s) => new Date(s.started_at) >= ws);

  const timeByProject: Record<string, number> = {};
  for (const s of weekSessions) {
    if (s.project) timeByProject[s.project] = (timeByProject[s.project] ?? 0) + s.duration_s;
  }

  const updStr = updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const activeProjects = projects
    .filter((p) => p.status !== "Archived" && p.status !== "Complete")
    .slice(0, 6);

  const inProgressTasks = tasks.filter((t) => t.status === "In Progress");

  return (
    <>
      <div className="display-title-bar">
        <div className="display-title-bar-left">Projects</div>
        <div className="display-title-bar-right">startpage · {updStr}</div>
      </div>

      <div className="display-content">
        {activeProjects.length > 0 ? (
          <div>
            <div className="display-section-header">Active projects</div>
            {activeProjects.map((p) => {
              const secs = timeByProject[p.name] ?? 0;
              const inProgress = inProgressTasks.filter((t) => t.project === p.name).slice(0, 3);
              return (
                <div key={p.id} style={{ marginBottom: "0.6rem" }}>
                  <div className="display-list-item">
                    <span className="display-list-item-dot" style={{ minWidth: "1.2rem" }}>◆</span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                    {secs > 0 && (
                      <span className="display-label">{fmtDur(secs)} this wk</span>
                    )}
                  </div>
                  {inProgress.map((t) => (
                    <div key={t.id} className="display-list-item" style={{ paddingLeft: "1.7rem" }}>
                      <span className="display-list-item-dot" style={{ minWidth: "1rem", fontSize: "0.7rem", color: "#888" }}>›</span>
                      <span style={{ fontSize: "0.75rem", color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.title}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="display-label">No active projects</div>
        )}
      </div>
    </>
  );
}
