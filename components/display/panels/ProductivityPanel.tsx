"use client";

import { useState, useEffect } from "react";

interface Session {
  id: string;
  label: string;
  duration_s: number;
  project: string | null;
  started_at: string;
}

interface PR {
  title: string;
  url?: string;
  ciState?: string | null;
}

interface GitHubData {
  myPRs?: PR[];
  reviewPRs?: PR[];
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
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function bar(filled: number, total: number, width = 10): string {
  const blocks = total > 0 ? Math.round((filled / total) * width) : 0;
  return "█".repeat(blocks) + "░".repeat(width - blocks);
}

function ciSymbol(state?: string | null): string {
  if (state === "SUCCESS") return "✓";
  if (state === "FAILURE" || state === "ERROR") return "✗";
  if (state === "PENDING") return "○";
  return "·";
}

export default function ProductivityPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [github, setGithub] = useState<GitHubData | null>(null);
  const [updated, setUpdated] = useState(new Date());

  const load = async () => {
    const [s, g] = await Promise.allSettled([
      fetch("/api/data/sessions").then((r) => r.json()),
      fetch("/api/integrations/github").then((r) => r.json()),
    ]);
    if (s.status === "fulfilled") {
      const raw = s.value;
      setSessions(Array.isArray(raw) ? raw : (raw.sessions ?? []));
    }
    if (g.status === "fulfilled") setGithub(g.value);
    setUpdated(new Date());
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ws = weekStart();
  const thisWeek = sessions.filter((s) => new Date(s.started_at) >= ws);

  const byProject: Record<string, number> = {};
  for (const s of thisWeek) {
    const key = s.project ?? s.label ?? "Other";
    byProject[key] = (byProject[key] ?? 0) + s.duration_s;
  }
  const entries = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxSecs = entries[0]?.[1] ?? 1;
  const totalSecs = entries.reduce((acc, [, v]) => acc + v, 0);

  const updStr = updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const myPRs = github?.myPRs ?? [];
  const reviewPRs = github?.reviewPRs ?? [];

  return (
    <>
      <div className="display-title-bar">
        <div className="display-title-bar-left">Productivity</div>
        <div className="display-title-bar-right">startpage · {updStr}</div>
      </div>

      <div className="display-content">
        {entries.length > 0 && (
          <div>
            <div className="display-section-header">
              This week · {fmtDur(totalSecs)}
            </div>
            {entries.map(([project, secs]) => (
              <div key={project} className="display-bar-row">
                <span className="display-bar-label">{project}</span>
                <span className="display-bar-time">{fmtDur(secs)}</span>
                <span className="display-bar-track">{bar(secs, maxSecs, 8)}</span>
              </div>
            ))}
          </div>
        )}

        {(myPRs.length > 0 || reviewPRs.length > 0) && (
          <div>
            <div className="display-section-header">
              GitHub
              {myPRs.length > 0 ? ` · ${myPRs.length} open PR${myPRs.length !== 1 ? "s" : ""}` : ""}
              {reviewPRs.length > 0 ? ` · ${reviewPRs.length} to review` : ""}
            </div>
            {myPRs.slice(0, 3).map((pr, i) => (
              <div key={i} className="display-list-item">
                <span
                  className="display-list-item-dot"
                  style={{
                    minWidth: "1.2rem",
                    color: pr.ciState === "SUCCESS" ? "#090" : pr.ciState === "FAILURE" ? "#c00" : "#888",
                  }}
                >
                  {ciSymbol(pr.ciState)}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.8rem" }}>
                  {pr.title}
                </span>
              </div>
            ))}
            {reviewPRs.slice(0, 2).map((pr, i) => (
              <div key={`r${i}`} className="display-list-item">
                <span className="display-list-item-dot" style={{ minWidth: "1.2rem", color: "#555" }}>▶</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.8rem" }}>
                  {pr.title}
                </span>
                <span className="display-label">review</span>
              </div>
            ))}
          </div>
        )}

        {entries.length === 0 && myPRs.length === 0 && (
          <div className="display-label">No data yet this week</div>
        )}
      </div>
    </>
  );
}
