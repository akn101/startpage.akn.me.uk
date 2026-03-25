"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import MorningPanel from "./panels/MorningPanel";
import TasksPanel from "./panels/TasksPanel";
import ProductivityPanel from "./panels/ProductivityPanel";
import ProjectsPanel from "./panels/ProjectsPanel";

const PANELS = ["Morning", "Tasks", "Productivity", "Projects"] as const;
const DEFAULT_INTERVAL_MS = 20_000;

interface Props {
  inline?: boolean;
}

export default function DisplayShell({ inline = false }: Props) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const intervalMs =
    typeof window !== "undefined"
      ? Number(localStorage.getItem("sp_display_interval") || DEFAULT_INTERVAL_MS)
      : DEFAULT_INTERVAL_MS;

  const advance = useCallback(() => {
    setCurrent((c) => (c + 1) % PANELS.length);
  }, []);

  useEffect(() => {
    if (paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(advance, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused, advance, intervalMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setCurrent((c) => (c + 1) % PANELS.length);
      if (e.key === "ArrowLeft") setCurrent((c) => (c - 1 + PANELS.length) % PANELS.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={inline ? "display-root-inline" : "display-root"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="display-panel">
        {current === 0 && <MorningPanel />}
        {current === 1 && <TasksPanel />}
        {current === 2 && <ProductivityPanel />}
        {current === 3 && <ProjectsPanel />}
      </div>

      <div className="display-dots">
        {PANELS.map((name, i) => (
          <button
            key={name}
            className={`display-dot${i === current ? " display-dot--active" : ""}`}
            onClick={() => setCurrent(i)}
            aria-label={`Go to ${name} panel`}
          />
        ))}
      </div>
    </div>
  );
}
