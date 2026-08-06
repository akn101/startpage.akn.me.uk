export interface QuickLink {
  label: string;
  url: string;
  color?: string;
}

export const quickLinks: QuickLink[] = [
  { label: "GitHub", url: "https://github.com", color: "#88C0D0" },
  { label: "Gmail", url: "https://mail.google.com", color: "#BF616A" },
  { label: "YouTube", url: "https://youtube.com", color: "#D08770" },
  { label: "Claude", url: "https://claude.ai", color: "#B48EAD" },
  { label: "Linear", url: "https://linear.app", color: "#81A1C1" },
  { label: "Notion", url: "https://notion.so", color: "#8FBCBB" },
  { label: "Twitter", url: "https://x.com", color: "#88C0D0" },
  { label: "Reddit", url: "https://reddit.com", color: "#D08770" },
];

export const idleTimeoutMs = 3 * 60 * 1000; // 3 minutes

// ── Life areas ─────────────────────────────────────────────────────────────
// Fallback only. The real list is the Category select options on the Notion
// projects database — rename them there and this list stops mattering.
export const lifeAreas = ["Work", "Projects", "Social", "Self"];

// ── Module toggles ─────────────────────────────────────────────────────────
// Flip to true to bring a module back. Code is kept intact either way, so
// re-enabling is a one-line change with no other edits needed.
//
// The school-era modules were switched off in Aug 2026 (sixth form finished).
export const modules = {
  /** Countdown to A-level papers. EXAMS[] in ExamCountdown.tsx is a fixed
   *  2026 list — refill it before turning this back on. */
  examCountdown: false,
  /** Homework tracker backed by /api/assignments (Notion). */
  assignments: false,
  /** Webcam capture + recent-visitor strip. Also gates the camera commands
   *  in the ⌘K palette. */
  cameraMonitor: false,
} as const;
