"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";

interface Project {
  id: string;
  name: string;
  status: string;
  color: string;
  category: string;
  is_public: boolean;
  url: string;
}

interface Task {
  id: string;
  title: string;
  project: string;
  priority: string;
  status: string;
  deadline: string | null;
  is_public: boolean;
  url: string;
}

const COLOR_MAP: Record<string, string> = {
  purple: "#9678ff",
  blue:   "#5b9ef6",
  green:  "#4ade80",
  orange: "#fb923c",
  red:    "#f87171",
};

const TASK_STATUS_CYCLE: Record<string, string> = {
  "Todo":        "In Progress",
  "In Progress": "Done",
  "Done":        "Todo",
};

const TASK_STATUS_CLASS: Record<string, string> = {
  "Todo":        "task-status-todo",
  "In Progress": "task-status-progress",
  "Done":        "task-status-done",
};

function isOverdue(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}

function fmtDeadline(deadline: string | null): string {
  if (!deadline) return "";
  const d = new Date(deadline);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : "";
}

type TimeMap = Record<string, number>;

const CATEGORIES = ["Dev", "Personal", "School", "Faith", "Music"];
const COLORS     = ["purple", "blue", "green", "orange", "red"];

export default function ProjectTracker() {
  const [projects, setProjects]   = useState<Project[]>([]);
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [timeMap, setTimeMap]     = useState<TimeMap>({});
  const [loading, setLoading]     = useState(true);
  const [addingTask, setAddingTask] = useState<string | null>(null);
  const [newTask, setNewTask]       = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName]     = useState("");
  const [newProjectCategory, setNewProjectCategory] = useState("Dev");
  const [newProjectColor, setNewProjectColor]   = useState("purple");
  const { authenticated } = useAuth();

  useEffect(() => {
    const load = () => {
      Promise.all([
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/data/sessions").then((r) => r.json()),
      ]).then(([{ projects: p, tasks: t }, { sessions: s }]) => {
        setProjects(p ?? []);
        setTasks(t ?? []);
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
        weekStart.setHours(0, 0, 0, 0);
        const map: TimeMap = {};
        for (const sess of (s ?? [])) {
          if (sess.project && sess.started_at && new Date(sess.started_at) >= weekStart) {
            map[sess.project] = (map[sess.project] ?? 0) + sess.duration_s;
          }
        }
        setTimeMap(map);
        setLoading(false);
      }).catch(() => setLoading(false));
    };
    load();
    window.addEventListener("refreshData", load);
    return () => window.removeEventListener("refreshData", load);
  }, []);

  const cycleTaskStatus = async (taskId: string, current: string) => {
    const next = TASK_STATUS_CYCLE[current] ?? "In Progress";
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: next } : t));
    if (next === "Done") {
      setTimeout(() => setTasks((prev) => prev.filter((t) => t.id !== taskId)), 1000);
    }
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, properties: { Status: { select: { name: next } } } }),
    });
  };

  const submitTask = (projectName: string) => {
    if (!newTask.trim()) return;
    fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "task", data: { title: newTask.trim(), project: projectName, status: "Todo", priority: "Medium" } }),
    })
      .then((r) => r.json())
      .then(({ id }) => {
        if (id) setTasks((prev) => [...prev, { id, title: newTask.trim(), project: projectName, priority: "Medium", status: "Todo", deadline: null, is_public: false, url: "" }]);
      });
    setNewTask("");
    setAddingTask(null);
  };

  const submitProject = () => {
    if (!newProjectName.trim()) return;
    fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "project", data: { name: newProjectName.trim(), category: newProjectCategory, color: newProjectColor, status: "Active" } }),
    })
      .then((r) => r.json())
      .then(({ id }) => {
        if (id) setProjects((prev) => [...prev, { id, name: newProjectName.trim(), status: "Active", color: newProjectColor, category: newProjectCategory, is_public: false, url: "" }]);
      });
    setNewProjectName("");
    setAddingProject(false);
  };

  if (loading) {
    return (
      <div className="project-tracker glass-sm feed-widget">
        <div className="feed-widget-header">Projects</div>
        <div className="feed-empty">Loading…</div>
      </div>
    );
  }

  const sorted = [...projects].sort((a, b) => {
    const ta = timeMap[a.name] ?? 0;
    const tb = timeMap[b.name] ?? 0;
    return ta !== tb ? ta - tb : a.name.localeCompare(b.name);
  });

  return (
    <div className="project-tracker glass-sm feed-widget">
      <div className="feed-widget-header">
        Projects
        {authenticated && (
          <button type="button" className="feed-header-btn" onClick={() => setAddingProject((v) => !v)}>
            {addingProject ? "✕" : "+"}
          </button>
        )}
      </div>

      {/* Add project inline form */}
      {addingProject && (
        <div className="project-add-form">
          <input
            className="project-add-input"
            autoFocus
            placeholder="Project name…"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitProject(); if (e.key === "Escape") setAddingProject(false); }}
          />
          <select aria-label="Category" className="project-add-select" value={newProjectCategory} onChange={(e) => setNewProjectCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Color" className="project-add-select" value={newProjectColor} onChange={(e) => setNewProjectColor(e.target.value)}>
            {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="task-add-btn" onClick={submitProject}>Add</button>
        </div>
      )}

      {projects.length === 0 && !addingProject && (
        <div className="feed-empty">No active projects</div>
      )}

      <div className="project-list">
        {sorted.map((proj) => {
          const projTasks  = tasks.filter((t) => t.project === proj.name);
          const inProgress = projTasks.filter((t) => t.status === "In Progress");
          const todo       = projTasks.filter((t) => t.status === "Todo");
          const accent     = COLOR_MAP[proj.color] ?? COLOR_MAP.purple;
          const timeLogged = timeMap[proj.name] ?? 0;

          return (
            <div key={proj.id} className="project-card" style={{ "--accent": accent } as React.CSSProperties}>
              <div className="project-card-header">
                <span className="project-dot" style={{ background: accent }} />
                <a href={proj.url} target="_blank" rel="noreferrer" className="project-name">{proj.name}</a>
                {proj.category && <span className="project-category">{proj.category}</span>}
                {timeLogged > 0 && <span className="project-time" title="This week">{fmtTime(timeLogged)}</span>}
              </div>

              {inProgress.length > 0 && (
                <div className="project-tasks">
                  {inProgress.map((t) => (
                    <div key={t.id} className="task-item in-progress">
                      <button
                        type="button"
                        className={`task-status-btn ${TASK_STATUS_CLASS[t.status] ?? ""}`}
                        title={`${t.status} — click to advance`}
                        onClick={() => authenticated && cycleTaskStatus(t.id, t.status)}
                      />
                      <a href={t.url || undefined} target="_blank" rel="noreferrer" className="task-title">{t.title}</a>
                      {t.deadline && (
                        <span className={`task-deadline${isOverdue(t.deadline) ? " overdue" : ""}`}>
                          {fmtDeadline(t.deadline)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {todo.length > 0 && (
                <div className="project-tasks todo-tasks">
                  {todo.slice(0, 3).map((t) => (
                    <div key={t.id} className="task-item">
                      <button
                        type="button"
                        className={`task-status-btn ${TASK_STATUS_CLASS[t.status] ?? ""}`}
                        title={`${t.status} — click to advance`}
                        onClick={() => authenticated && cycleTaskStatus(t.id, t.status)}
                      />
                      <span className="task-title muted">{t.title}</span>
                      {t.deadline && (
                        <span className={`task-deadline${isOverdue(t.deadline) ? " overdue" : ""}`}>
                          {fmtDeadline(t.deadline)}
                        </span>
                      )}
                    </div>
                  ))}
                  {todo.length > 3 && <div className="task-more">+{todo.length - 3} more</div>}
                </div>
              )}

              {authenticated && addingTask === proj.name ? (
                <div className="task-add-row">
                  <input
                    className="task-add-input"
                    autoFocus
                    placeholder="New task…"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitTask(proj.name);
                      if (e.key === "Escape") setAddingTask(null);
                    }}
                  />
                  <button type="button" className="task-add-btn" onClick={() => submitTask(proj.name)}>+</button>
                </div>
              ) : authenticated ? (
                <button type="button" className="task-add-trigger" onClick={() => setAddingTask(proj.name)}>
                  + add task
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
