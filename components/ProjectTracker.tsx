"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface Project {
  id: string;
  name: string;
  status: string;
  color: string;
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

function isOverdue(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}

function fmtDeadline(deadline: string | null): string {
  if (!deadline) return "";
  const d = new Date(deadline);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function ProjectTracker() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [loading, setLoading]   = useState(true);
  const [addingTask, setAddingTask] = useState<string | null>(null); // project name
  const [newTask, setNewTask]       = useState("");
  const { authenticated } = useAuth();

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then(({ projects: p, tasks: t }) => {
        setProjects(p ?? []);
        setTasks(t ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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

  if (loading) {
    return (
      <div className="project-tracker glass-sm feed-widget">
        <div className="feed-widget-header">Projects</div>
        <div className="feed-empty">Loading…</div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="project-tracker glass-sm feed-widget">
        <div className="feed-widget-header">
          Projects
          {authenticated && <span className="feed-hint">Add in Notion</span>}
        </div>
        <div className="feed-empty">No active projects</div>
      </div>
    );
  }

  return (
    <div className="project-tracker glass-sm feed-widget">
      <div className="feed-widget-header">Projects</div>
      <div className="project-list">
        {projects.map((proj) => {
          const projTasks  = tasks.filter((t) => t.project === proj.name);
          const inProgress = projTasks.filter((t) => t.status === "In Progress");
          const todo       = projTasks.filter((t) => t.status === "Todo");
          const accent     = COLOR_MAP[proj.color] ?? COLOR_MAP.purple;

          return (
            <div key={proj.id} className="project-card" style={{ "--accent": accent } as React.CSSProperties}>
              <div className="project-card-header">
                <span className="project-dot" style={{ background: accent }} />
                <a href={proj.url} target="_blank" rel="noreferrer" className="project-name">{proj.name}</a>
                <span className="project-status-badge">{proj.status}</span>
              </div>

              {inProgress.length > 0 && (
                <div className="project-tasks">
                  {inProgress.map((t) => (
                    <div key={t.id} className="task-item in-progress">
                      <span className="task-bullet" />
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
                      <span className="task-bullet" />
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
