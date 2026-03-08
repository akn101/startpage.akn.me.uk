"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";

interface Todo {
  id: string;
  text: string;
  done: boolean;
  is_public: boolean;
}

interface Suggestion {
  todoId: string;
  todoText: string;
  project: string | null;
}

interface Props {
  externalAdd?: string | null;
}

type MigrateState = "idle" | "loading" | "preview" | "executing" | "done";

export default function Todos({ externalAdd }: Props) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const { authenticated } = useAuth();

  useEffect(() => {
    const load = () =>
      fetch("/api/data/todos")
        .then((r) => r.json())
        .then(({ todos: data }) => { if (data) setTodos(data); });
    load();
    window.addEventListener("refreshData", load);
    return () => window.removeEventListener("refreshData", load);
  }, []);

  // Listen for clearDoneTodos event from command palette
  useEffect(() => {
    const handler = async () => {
      const doneIds = todos.filter((t) => t.done).map((t) => t.id);
      if (doneIds.length === 0) return;
      await fetch("/api/data/todos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: doneIds }) });
      setTodos((prev) => prev.filter((t) => !t.done));
    };
    window.addEventListener("clearDoneTodos", handler);
    return () => window.removeEventListener("clearDoneTodos", handler);
  }, [todos]);

  // Accept external adds from command palette
  useEffect(() => {
    if (!externalAdd) return;
    fetch("/api/data/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: externalAdd }) })
      .then((r) => r.json())
      .then(({ todo }) => { if (todo) setTodos((prev) => [...prev, todo]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalAdd]);

  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      const todo = next.find((t) => t.id === id);
      if (todo) fetch("/api/data/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done: todo.done }) });
      return next;
    });
  }, []);

  const addTodo = useCallback(() => {
    const text = newText.trim();
    if (!text) { setAdding(false); return; }
    fetch("/api/data/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
      .then((r) => r.json())
      .then(({ todo }) => { if (todo) setTodos((prev) => [...prev, todo]); });
    setNewText("");
    setAdding(false);
  }, [newText]);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  // AI migrate state
  const [migrateState, setMigrateState] = useState<MigrateState>("idle");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const startMigrate = useCallback(async () => {
    setMigrateState("loading");
    try {
      const res = await fetch("/api/data/todos/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyze: true }),
      });
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setMigrateState("preview");
    } catch {
      setMigrateState("idle");
    }
  }, []);

  const confirmMigrate = useCallback(async () => {
    setMigrateState("executing");
    try {
      const res = await fetch("/api/data/todos/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, suggestions }),
      });
      const data = await res.json();
      const movedIds = suggestions.filter((s) => s.project !== null).map((s) => s.todoId);
      setTodos((prev) => prev.filter((t) => !movedIds.includes(t.id)));
      setSuggestions([]);
      setMigrateState("done");
      setTimeout(() => setMigrateState("idle"), 2000);
      console.log(`Moved ${data.moved} todos to projects`);
    } catch {
      setMigrateState("idle");
    }
  }, [suggestions]);

  const cancelMigrate = useCallback(() => {
    setSuggestions([]);
    setMigrateState("idle");
  }, []);

  // Done todos sink to bottom
  const sorted = [...todos.filter((t) => !t.done), ...todos.filter((t) => t.done)];
  const undoneTodos = todos.filter((t) => !t.done);
  const matchedCount = suggestions.filter((s) => s.project !== null).length;

  return (
    <div className="todos-widget glass-sm">
      <div className="todos-header">
        Todos
        {authenticated && (
          <div className="todos-header-actions">
            {migrateState === "idle" && undoneTodos.length > 0 && (
              <button
                type="button"
                className="todos-migrate-btn"
                onClick={startMigrate}
                title="AI: move todos to projects"
              >
                ✦
              </button>
            )}
            {migrateState === "loading" && (
              <span className="todos-migrate-spinner" title="Analyzing…">○</span>
            )}
            {migrateState === "done" && (
              <span className="todos-migrate-done">✓</span>
            )}
            {(migrateState === "idle" || migrateState === "done") && (
              <button type="button" className="todos-add-btn" onClick={() => setAdding(true)} title="Add todo">+</button>
            )}
          </div>
        )}
      </div>

      {migrateState === "preview" && (
        <div className="todos-migrate-preview">
          <div className="todos-migrate-preview-list">
            {suggestions.map((s) => (
              <div key={s.todoId} className="todos-migrate-row">
                <span className="todos-migrate-text">{s.todoText}</span>
                <span className={`todos-migrate-project${s.project ? " matched" : " unmatched"}`}>
                  {s.project ?? "no match"}
                </span>
              </div>
            ))}
          </div>
          <div className="todos-migrate-actions">
            <button type="button" className="todos-migrate-confirm" onClick={confirmMigrate} disabled={matchedCount === 0}>
              Move {matchedCount}
            </button>
            <button type="button" className="todos-migrate-cancel" onClick={cancelMigrate}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {migrateState === "executing" && (
        <div className="todos-migrate-executing">Moving to projects…</div>
      )}

      {migrateState !== "preview" && migrateState !== "executing" && (
        <div className="todos-list">
          {sorted.length === 0 && !adding ? (
            <div className="todos-empty">No tasks</div>
          ) : (
            sorted.map((t) => (
              <div
                key={t.id}
                className={`todo-item${t.done ? " done" : ""}${!authenticated ? " readonly" : ""}`}
                onClick={() => authenticated && toggle(t.id)}
              >
                <div className="todo-check">{t.done ? "✓" : ""}</div>
                <span>{t.text}</span>
              </div>
            ))
          )}
          {adding && (
            <div className="todo-add-row">
              <input
                ref={inputRef}
                className="todo-add-input"
                placeholder="New todo…"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTodo();
                  if (e.key === "Escape") { setAdding(false); setNewText(""); }
                }}
                onBlur={addTodo}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
