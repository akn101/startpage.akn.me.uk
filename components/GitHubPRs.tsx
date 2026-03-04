"use client";

import { useEffect, useState } from "react";

interface PR {
  title: string;
  url: string;
  repo: string;
  createdAt: string;
}

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function GitHubPRs() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch("/api/integrations/github")
      .then((r) => r.json())
      .then((d) => { setPrs(d.prs ?? []); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  useEffect(() => {
    load();
    window.addEventListener("refreshData", load);
    return () => window.removeEventListener("refreshData", load);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="feed-widget glass-sm">
      <div className="feed-widget-header">Open PRs</div>
      {loading && <div className="feed-empty">loading…</div>}
      {error && <div className="feed-error">could not load PRs</div>}
      {!loading && !error && prs.length === 0 && (
        <div className="feed-empty">no open PRs</div>
      )}
      {prs.map((pr) => (
        <a key={pr.url} href={pr.url} target="_blank" rel="noopener noreferrer" className="feed-item">
          <span className="feed-item-title">{pr.title}</span>
          <span className="feed-item-meta">{pr.repo} · {timeAgo(pr.createdAt)}</span>
        </a>
      ))}
    </div>
  );
}
