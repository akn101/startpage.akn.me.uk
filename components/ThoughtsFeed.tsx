"use client";

import { useEffect, useState } from "react";

export default function ThoughtsFeed() {
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch("https://thoughts.akn.me.uk/api/thoughts")
      .then((r) => r.json())
      .then((d) => { setThoughts(d.thoughts ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("refreshData", handler);
    return () => window.removeEventListener("refreshData", handler);
  }, []);

  return (
    <div className="feed-widget glass">
      <div className="feed-widget-header">thoughts</div>
      {loading ? (
        <span className="feed-empty">loading…</span>
      ) : thoughts.length === 0 ? (
        <span className="feed-empty">no thoughts yet</span>
      ) : (
        <div className="thoughts-list">
          {thoughts.map((t, i) => (
            <p key={i} className="thought-item">{t}</p>
          ))}
        </div>
      )}
    </div>
  );
}
