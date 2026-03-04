"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";

interface Todo {
  id: string;
  text: string;
  done: boolean;
  is_public: boolean;
}

interface Props {
  externalAdd?: string | null;
}

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

  const toggle = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      const todo = next.find((t) => t.id === id);
      if (todo) fetch("/api/data/todos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done: todo.done }) });
      return next;
    });
  }, []);

  const visible = todos.slice(0, 6);

  return (
    <div className="todos-widget glass-sm">
      <div className="todos-header">Todos</div>
      {visible.length === 0 ? (
        <div className="todos-empty">No tasks — add with ⌘K → /todo</div>
      ) : (
        visible.map((t) => (
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
    </div>
  );
}
