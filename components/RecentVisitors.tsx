"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getClipsNear } from "@/lib/clip-store";

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

function VisitorCard({ visitor }: { visitor: Visitor }) {
  const [clipUrl, setClipUrl]   = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const objectUrlRef            = useRef<string | null>(null);

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }

    if (clipUrl) {
      setExpanded(true);
      return;
    }

    setLoading(true);
    try {
      const ts    = new Date(visitor.captured_at).getTime();
      const clips = await getClipsNear(ts);
      if (clips.length > 0) {
        // Pick closest clip
        const best = clips.reduce((a, b) =>
          Math.abs(a.timestamp - ts) < Math.abs(b.timestamp - ts) ? a : b
        );
        const url = URL.createObjectURL(best.blob);
        objectUrlRef.current = url;
        setClipUrl(url);
        setExpanded(true);
      } else {
        setExpanded(true); // expand to show "no clip" message
      }
    } catch {
      setExpanded(true);
    } finally {
      setLoading(false);
    }
  }

  // Revoke object URL when card is hidden or unmounted
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return (
    <div className={`visitor-item${expanded ? " expanded" : ""}`} onClick={toggle}>
      {visitor.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={visitor.imageUrl} alt="" className="visitor-thumb" />
      ) : (
        <div className="visitor-thumb-placeholder">👤</div>
      )}
      <div className="visitor-info">
        <span className="visitor-label">
          {visitor.face_label === "motion" ? "🚪 motion" : `👤 ${visitor.face_label}`}
        </span>
        <span className="visitor-time">{timeAgo(visitor.captured_at)}</span>
      </div>
      {loading && <span className="visitor-clip-loading">…</span>}
      {!loading && !clipUrl && !expanded && (
        <span className="visitor-clip-hint">▶</span>
      )}

      {expanded && (
        <div
          className="visitor-clip-player"
          onClick={(e) => e.stopPropagation()}
        >
          {clipUrl ? (
            <video
              src={clipUrl}
              controls
              autoPlay
              muted
              playsInline
              className="visitor-clip-video"
            />
          ) : (
            <span className="visitor-clip-none">No clip saved for this event</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecentVisitors() {
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const { authenticated } = useAuth();

  const load = () => {
    fetch("/api/visitors/recent")
      .then((r) => r.json())
      .then(({ visitors: data }) => { if (Array.isArray(data)) setVisitors(data); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!authenticated) return;
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  if (!authenticated) return null;

  // Dedup: keep only the latest entry per label
  const deduped = visitors
    .reduce<Visitor[]>((acc, v) => {
      if (!acc.find((x) => x.face_label === v.face_label)) acc.push(v);
      return acc;
    }, [])
    .slice(0, 5);

  return (
    <div className="visitors-widget glass-sm feed-widget">
      <div className="feed-widget-header">Recent Visitors</div>
      {deduped.length === 0 ? (
        <div className="feed-empty">No visitors captured yet</div>
      ) : (
        <div className="visitors-list">
          {deduped.map((v) => (
            <VisitorCard key={v.id} visitor={v} />
          ))}
        </div>
      )}
    </div>
  );
}
