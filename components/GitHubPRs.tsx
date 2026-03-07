"use client";

import { useEffect, useState } from "react";

type CIState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | null;

interface Item { title: string; url: string; repo: string; owner: string; createdAt: string; ci?: CIState }
interface Repo  { name: string; owner: string; url: string; pushedAt: string; ci?: CIState }
interface GHData { prs: Item[]; reviews: Item[]; issues: Item[]; repos: Repo[] }

const CI_ICON:  Record<string, string> = { SUCCESS: "✓", FAILURE: "✗", ERROR: "✗", PENDING: "●" };
const CI_CLASS: Record<string, string> = { SUCCESS: "ci-pass", FAILURE: "ci-fail", ERROR: "ci-fail", PENDING: "ci-pending" };

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

type Tab = "prs" | "reviews" | "issues" | "repos";

export default function GitHubWidget() {
  const [data, setData] = useState<GHData>({ prs: [], reviews: [], issues: [], repos: [] });
  const [tab, setTab]   = useState<Tab>("repos");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const load = () => {
    fetch("/api/integrations/github")
      .then((r) => r.json())
      .then((d) => { setData({ prs: d.prs ?? [], reviews: d.reviews ?? [], issues: d.issues ?? [], repos: d.repos ?? [] }); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  useEffect(() => {
    load();
    window.addEventListener("refreshData", load);
    return () => window.removeEventListener("refreshData", load);
  }, []); // eslint-disable-line

  const TABS: { key: Tab; label: string; count: number | null }[] = [
    { key: "prs",     label: "My PRs",  count: data.prs.length },
    { key: "reviews", label: "Reviews", count: data.reviews.length },
    { key: "issues",  label: "Issues",  count: data.issues.length },
    { key: "repos",   label: "Recent",  count: null },
  ];

  const listItems = tab === "repos" ? null : data[tab];
  const EMPTY: Record<Tab, string> = {
    prs: "no open PRs", reviews: "no reviews requested",
    issues: "no assigned issues", repos: "no recent activity",
  };

  return (
    <div className="feed-widget glass-sm">
      <div className="feed-widget-header">GitHub</div>

      <div className="gh-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`gh-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {(t.count ?? 0) > 0 && <span className="gh-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {loading && <div className="feed-empty">loading…</div>}
      {!loading && error && <div className="feed-error">could not load</div>}

      {!loading && !error && tab !== "repos" && (listItems as Item[]).length === 0 && (
        <div className="feed-empty">{EMPTY[tab]}</div>
      )}

      {!loading && !error && tab !== "repos" && (listItems as Item[]).map((item) => (
        <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="feed-item gh-item">
          {item.ci != null && (
            <span className={`ci-dot ${CI_CLASS[item.ci] ?? ""}`} title={item.ci}>{CI_ICON[item.ci]}</span>
          )}
          <span className="gh-item-body">
            <span className="feed-item-title">{item.title}</span>
            <span className="feed-item-meta">{item.owner}/{item.repo} · {timeAgo(item.createdAt)}</span>
          </span>
        </a>
      ))}

      {!loading && !error && tab === "repos" && data.repos.length === 0 && (
        <div className="feed-empty">{EMPTY.repos}</div>
      )}
      {!loading && !error && tab === "repos" && data.repos.map((repo) => (
        <a key={repo.url} href={repo.url} target="_blank" rel="noopener noreferrer" className="feed-item gh-item">
          <span className={`ci-badge${repo.ci ? ` ci-badge-${repo.ci.toLowerCase()}` : " ci-badge-none"}`}>
            {repo.ci ? CI_ICON[repo.ci] : "·"}
          </span>
          <span className="gh-item-body">
            <span className="feed-item-title">
              <span className="gh-repo-owner">{repo.owner}</span>
              <span className="gh-repo-sep">/</span>
              <span className="gh-repo-name">{repo.name}</span>
            </span>
            <span className="feed-item-meta">{timeAgo(repo.pushedAt)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
