"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface Habit {
  id: string;
  name: string;
  sort: number;
  days: string[]; // YYYY-MM-DD, newest first
}

/** Local calendar date, not UTC — a habit belongs to the day you were living. */
function localDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Consecutive days ending today, or ending yesterday if today isn't done yet —
 * so a streak doesn't visibly die at midnight before you've had the chance.
 */
function streakOf(days: Set<string>): number {
  let n = 0;
  let offset = days.has(localDay(0)) ? 0 : 1;
  if (offset === 1 && !days.has(localDay(1))) return 0;
  while (days.has(localDay(offset))) {
    n++;
    offset++;
  }
  return n;
}

export default function Habits() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const { authenticated } = useAuth();

  useEffect(() => {
    const load = () => {
      fetch("/api/data/habits")
        .then((r) => r.json())
        .then(({ habits: h }) => {
          setHabits(h ?? []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };
    load();
    window.addEventListener("refreshData", load);
    return () => window.removeEventListener("refreshData", load);
  }, []);

  const toggle = async (habit: Habit) => {
    if (!authenticated) return;
    const today = localDay(0);
    const done = !habit.days.includes(today);

    setHabits((prev) =>
      prev.map((h) =>
        h.id === habit.id
          ? { ...h, days: done ? [today, ...h.days] : h.days.filter((d) => d !== today) }
          : h
      )
    );

    await fetch("/api/data/habits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: habit.id, day: today, done }),
    });
  };

  const submit = async () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setAdding(false);
    const { habit } = await fetch("/api/data/habits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    if (habit) setHabits((prev) => [...prev, habit]);
  };

  const remove = async (id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    await fetch("/api/data/habits", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const weekOffsets = [6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="feed-widget glass-sm habits-widget">
      <div className="feed-widget-header">
        Habits
        {authenticated && (
          <button type="button" className="feed-header-btn" onClick={() => setAdding((v) => !v)}>
            {adding ? "✕" : "+"}
          </button>
        )}
      </div>

      {adding && (
        <div className="task-add-row">
          <input
            className="task-add-input"
            autoFocus
            placeholder="New habit…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button type="button" className="task-add-btn" onClick={submit}>+</button>
        </div>
      )}

      {loading && <div className="feed-empty">Loading…</div>}

      {!loading && habits.length === 0 && !adding && (
        <div className="feed-empty">
          {authenticated ? "No habits yet" : "Log in to track habits"}
        </div>
      )}

      <div className="habits-list">
        {habits.map((h) => {
          const days = new Set(h.days);
          const doneToday = days.has(localDay(0));
          const streak = streakOf(days);

          return (
            <div key={h.id} className={`habit-row${doneToday ? " done" : ""}`}>
              <button
                type="button"
                className={`habit-check${doneToday ? " done" : ""}`}
                aria-label={`${doneToday ? "Unmark" : "Mark"} ${h.name} for today`}
                onClick={() => toggle(h)}
              />
              <span className="habit-name">{h.name}</span>
              <span className="habit-week" aria-hidden>
                {weekOffsets.map((o) => (
                  <span key={o} className={`habit-dot${days.has(localDay(o)) ? " on" : ""}`} />
                ))}
              </span>
              {streak > 0 && (
                <span className={`habit-streak${streak >= 7 ? " hot" : ""}`}>
                  {streak}d
                </span>
              )}
              {authenticated && (
                <button
                  type="button"
                  className="habit-delete"
                  aria-label={`Delete ${h.name}`}
                  onClick={() => remove(h.id)}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
