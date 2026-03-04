"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface Visitor {
  id: string;
  captured_at: string;
  face_label: string;
  imageUrl: string | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24)  return `${hr}h ago`;
  return `${day}d ago`;
}

export default function RecentVisitors() {
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const { authenticated } = useAuth();

  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/visitors/recent")
      .then((r) => r.json())
      .then(({ visitors: data }) => { if (data) setVisitors(data); })
      .catch(() => {});
  }, [authenticated]);

  if (!authenticated) return null;

  return (
    <div className="visitors-widget glass-sm feed-widget">
      <div className="feed-widget-header">Recent Visitors</div>
      {visitors.length === 0 ? (
        <div className="feed-empty">No visitors captured yet</div>
      ) : (
        <div className="visitors-list">
          {visitors.slice(0, 5).map((v) => (
            <div key={v.id} className="visitor-item">
              {v.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.imageUrl} alt="" className="visitor-thumb" />
              ) : (
                <div className="visitor-thumb-placeholder">👤</div>
              )}
              <div className="visitor-info">
                <span className="visitor-label">{v.face_label}</span>
                <span className="visitor-time">{timeAgo(v.captured_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
