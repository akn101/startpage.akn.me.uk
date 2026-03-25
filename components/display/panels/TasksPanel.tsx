"use client";

import { useState, useEffect } from "react";

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

interface Assignment {
  title: string;
  status: string;
  due: string;
  subject?: string;
}

function formatDue(due: string): string {
  const diff = Math.round((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff}d`;
}

function isOverdue(due: string): boolean {
  return new Date(due).getTime() < Date.now();
}

export default function TasksPanel() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [updated, setUpdated] = useState(new Date());

  const load = async () => {
    const [t, a] = await Promise.allSettled([
      fetch("/api/data/todos").then((r) => r.json()),
      fetch("/api/assignments").then((r) => r.json()),
    ]);
    if (t.status === "fulfilled") {
      const raw = t.value;
      const list: Todo[] = Array.isArray(raw) ? raw : (raw.todos ?? []);
      setTodos(list.filter((td) => !td.done));
    }
    if (a.status === "fulfilled") {
      const raw = a.value;
      const list: Assignment[] = Array.isArray(raw) ? raw : (raw.assignments ?? []);
      const cutoff = Date.now() + 21 * 86_400_000;
      setAssignments(
        list
          .filter((x) => x.status !== "Complete" && x.status !== "Archived")
          .filter((x) => !x.due || new Date(x.due).getTime() <= cutoff)
          .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
          .slice(0, 10)
      );
    }
    setUpdated(new Date());
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updStr = updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="display-title-bar">
        <div className="display-title-bar-left">Tasks</div>
        <div className="display-title-bar-right">startpage · {updStr}</div>
      </div>

      <div className="display-content">
        {todos.length > 0 && (
          <div>
            <div className="display-section-header">Todos ({todos.length})</div>
            {todos.slice(0, 10).map((t) => (
              <div key={t.id} className="display-list-item">
                <span className="display-list-item-dot" style={{ minWidth: "1.2rem" }}>□</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.text}
                </span>
              </div>
            ))}
            {todos.length > 10 && (
              <div className="display-label" style={{ marginTop: "0.1rem" }}>+{todos.length - 10} more</div>
            )}
          </div>
        )}

        {assignments.length > 0 && (
          <div>
            <div className="display-section-header">Assignments due soon</div>
            {assignments.map((a, i) => (
              <div
                key={i}
                className={`display-list-item${isOverdue(a.due) ? " display-list-item--overdue" : ""}`}
              >
                <span
                  className="display-list-item-dot"
                  style={{ minWidth: "1.2rem", color: isOverdue(a.due) ? "#c00" : "#555" }}
                >
                  {isOverdue(a.due) ? "!" : "·"}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.title}{a.subject ? ` (${a.subject})` : ""}
                </span>
                <span className="display-label" style={{ color: isOverdue(a.due) ? "#c00" : undefined }}>
                  {formatDue(a.due)}
                </span>
              </div>
            ))}
          </div>
        )}

        {todos.length === 0 && assignments.length === 0 && (
          <div className="display-label">All clear</div>
        )}
      </div>
    </>
  );
}
