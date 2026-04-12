"use client";

import { useEffect, useState } from "react";

interface Exam {
  name: string;
  subject: string;
  date: Date;
}

const EXAMS: Exam[] = [
  { name: "FM Pure Core 1",            subject: "FM",      date: new Date("2026-05-14T13:30:00") },
  { name: "Physics Component 1",       subject: "Physics", date: new Date("2026-05-20T13:30:00") },
  { name: "FM Pure Core 2",            subject: "FM",      date: new Date("2026-05-21T13:30:00") },
  { name: "Physics Component 2",       subject: "Physics", date: new Date("2026-06-01T13:30:00") },
  { name: "RS Philosophy of Religion", subject: "RS",      date: new Date("2026-06-04T09:00:00") },
  { name: "FM Statistics",             subject: "FM",      date: new Date("2026-06-05T13:30:00") },
  { name: "Physics Component 3",       subject: "Physics", date: new Date("2026-06-08T13:30:00") },
  { name: "RS Religion & Ethics",      subject: "RS",      date: new Date("2026-06-09T09:00:00") },
  { name: "RS Christian Thought",      subject: "RS",      date: new Date("2026-06-12T09:00:00") },
  { name: "FM Mechanics",              subject: "FM",      date: new Date("2026-06-12T13:30:00") },
];

const SUBJECT_COLOR: Record<string, string> = {
  FM:      "rgba(143,188,187,0.9)",  // nord teal
  Physics: "rgba(129,161,193,0.9)",  // nord blue
  RS:      "rgba(180,142,173,0.9)",  // nord purple
};

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}

function formatMs(ms: number): string {
  if (ms <= 0) return "now";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export default function ExamCountdown() {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const upcoming = EXAMS
    .filter((e) => e.date > now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const next = upcoming[0] ?? null;
  const msUntil = next ? next.date.getTime() - now.getTime() : 0;

  return (
    <div className="feed-widget glass-sm exam-countdown">
      <div className="feed-widget-header">Exam Schedule</div>

      {next ? (
        <div className="exam-next">
          <div className="exam-next-label">next up</div>
          <div className="exam-next-name" style={{ color: SUBJECT_COLOR[next.subject] }}>
            {next.name}
          </div>
          <div className="exam-next-countdown">{formatMs(msUntil)}</div>
          <div className="exam-next-date">
            {next.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            {" · "}
            {next.date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      ) : (
        <div className="exam-all-done">all exams complete</div>
      )}

      <div className="exam-list">
        {EXAMS.map((exam, i) => {
          const passed = exam.date <= now;
          const days = daysUntil(exam.date, now);
          const urgent = !passed && days <= 7;
          return (
            <div
              key={i}
              className={`exam-item${passed ? " exam-item--past" : ""}${urgent ? " exam-item--urgent" : ""}`}
            >
              <span className="exam-item-tag" style={{ color: passed ? undefined : SUBJECT_COLOR[exam.subject] }}>
                {exam.subject}
              </span>
              <span className="exam-item-name">{exam.name}</span>
              <span className="exam-item-days">
                {passed ? "done" : days === 0 ? "today" : `${days}d`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
