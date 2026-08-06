"use client";

import { useEffect, useState } from "react";
import { lifeAreas } from "@/lib/config";

interface Project { name: string; category: string; color: string }
interface Session { project: string | null; duration_s: number; started_at: string }

const COLOR_MAP: Record<string, string> = {
  purple: "#9678ff",
  blue:   "#5b9ef6",
  green:  "#4ade80",
  orange: "#fb923c",
  red:    "#f87171",
};

// Same accent order the project cards use, so an area keeps one colour
const AREA_COLORS = ["#9678ff", "#5b9ef6", "#4ade80", "#fb923c", "#f87171"];

function mondayThisWeek(): Date {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtHours(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface AreaTotal { area: string; seconds: number; color: string }

export default function WeekReview() {
  const [areas, setAreas] = useState<AreaTotal[]>([]);
  const [untouched, setUntouched] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [uncategorised, setUncategorised] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      Promise.all([
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/data/sessions").then((r) => r.json()),
      ])
        .then(([{ projects, categories }, { sessions }]) => {
          const projs: Project[] = projects ?? [];
          const sess: Session[] = sessions ?? [];
          const weekStart = mondayThisWeek().getTime();

          // project name → seconds logged this week
          const byProject: Record<string, number> = {};
          let untracked = 0;
          let sum = 0;
          for (const s of sess) {
            if (!s.started_at || new Date(s.started_at).getTime() < weekStart) continue;
            const secs = s.duration_s ?? 0;
            sum += secs;
            if (s.project) byProject[s.project] = (byProject[s.project] ?? 0) + secs;
            else untracked += secs;
          }

          // roll project totals up into their life area
          const areaOrder: string[] =
            Array.isArray(categories) && categories.length > 0 ? categories : lifeAreas;
          const byArea: Record<string, number> = {};
          for (const p of projs) {
            const secs = byProject[p.name] ?? 0;
            if (secs === 0) continue;
            const area = p.category || "Uncategorised";
            byArea[area] = (byArea[area] ?? 0) + secs;
          }

          const ordered = Object.keys(byArea).sort((a, b) => {
            const ia = areaOrder.indexOf(a);
            const ib = areaOrder.indexOf(b);
            if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            return a.localeCompare(b);
          });

          setAreas(
            ordered.map((area, i) => ({
              area,
              seconds: byArea[area],
              color: AREA_COLORS[areaOrder.indexOf(area) >= 0 ? areaOrder.indexOf(area) % AREA_COLORS.length : i % AREA_COLORS.length],
            }))
          );
          setUntouched(projs.filter((p) => !byProject[p.name]));
          setUncategorised(untracked);
          setTotal(sum);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };

    load();
    window.addEventListener("refreshData", load);
    return () => window.removeEventListener("refreshData", load);
  }, []);

  const max = areas.reduce((m, a) => Math.max(m, a.seconds), 0);

  return (
    <div className="feed-widget glass-sm week-review">
      <div className="feed-widget-header">
        This week
        {total > 0 && <span className="week-total">{fmtHours(total)}</span>}
      </div>

      {loading && <div className="feed-empty">Loading…</div>}

      {!loading && total === 0 && (
        <div className="feed-empty">Nothing tracked yet this week</div>
      )}

      {!loading && areas.length > 0 && (
        <div className="week-areas">
          {areas.map((a) => (
            <div key={a.area} className="week-area">
              <div className="week-area-row">
                <span className="week-area-name">{a.area}</span>
                <span className="week-area-time">{fmtHours(a.seconds)}</span>
              </div>
              <div className="week-bar-track">
                <div
                  className="week-bar-fill"
                  style={{
                    width: max > 0 ? `${Math.round((a.seconds / max) * 100)}%` : "0%",
                    background: a.color,
                  }}
                />
              </div>
            </div>
          ))}
          {uncategorised > 0 && (
            <div className="week-untracked">{fmtHours(uncategorised)} not matched to a project</div>
          )}
        </div>
      )}

      {!loading && untouched.length > 0 && (
        <div className="week-untouched">
          <div className="week-untouched-label">untouched</div>
          <div className="week-untouched-list">
            {untouched.slice(0, 6).map((p) => (
              <span
                key={p.name}
                className="week-chip"
                style={{ "--chip": COLOR_MAP[p.color] ?? COLOR_MAP.purple } as React.CSSProperties}
              >
                {p.name}
              </span>
            ))}
            {untouched.length > 6 && <span className="week-chip more">+{untouched.length - 6}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
