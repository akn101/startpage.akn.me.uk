"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

interface Incident {
  incidentId: string;
  title: string;
  description: string;
  service: string;
  url: string;
  status: string;
  startTime: string;
  date: string;
}

interface UrlEntry { name: string; url: string; }

interface StatusData {
  incidents: { active: Incident[]; resolved: Incident[] };
  urls: UrlEntry[];
}

export default function StatusAdmin() {
  const { isAdmin, authenticated } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Incident form
  const [incTitle, setIncTitle] = useState("");
  const [incDesc, setIncDesc] = useState("");
  const [incService, setIncService] = useState("");
  const [incUrl, setIncUrl] = useState("");

  // URL form
  const [urlName, setUrlName] = useState("");
  const [urlAddr, setUrlAddr] = useState("");

  useEffect(() => {
    if (!authenticated) return;
    if (!isAdmin) { router.replace("/"); return; }
    fetch("/api/admin/status")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [authenticated, isAdmin]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 3000); }

  async function createIncident(e: React.FormEvent) {
    e.preventDefault();
    if (!incTitle || !incService) return;
    setSaving(true);
    const res = await fetch("/api/admin/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "incident", title: incTitle, description: incDesc, service: incService, url: incUrl }),
    });
    if (res.ok) {
      flash("Incident created");
      setIncTitle(""); setIncDesc(""); setIncService(""); setIncUrl("");
      const d = await fetch("/api/admin/status").then((r) => r.json());
      setData(d);
    } else flash("Failed to create incident");
    setSaving(false);
  }

  async function resolveIncident(id: string) {
    setSaving(true);
    const res = await fetch("/api/admin/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId: id, action: "resolve" }),
    });
    if (res.ok) {
      flash("Resolved");
      const d = await fetch("/api/admin/status").then((r) => r.json());
      setData(d);
    } else flash("Failed");
    setSaving(false);
  }

  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!urlName || !urlAddr) return;
    setSaving(true);
    const res = await fetch("/api/admin/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "url", name: urlName, url: urlAddr }),
    });
    if (res.ok) {
      flash("URL added");
      setUrlName(""); setUrlAddr("");
      const d = await fetch("/api/admin/status").then((r) => r.json());
      setData(d);
    } else flash("Failed");
    setSaving(false);
  }

  async function removeUrl(name: string) {
    setSaving(true);
    const res = await fetch("/api/admin/status", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      flash(`Removed ${name}`);
      const d = await fetch("/api/admin/status").then((r) => r.json());
      setData(d);
    } else flash("Failed");
    setSaving(false);
  }

  if (!authenticated || loading) return <div className="status-admin-loading">loading…</div>;

  return (
    <div className="status-admin">
      <div className="status-admin-header">
        <a href="/" className="status-admin-back">← back</a>
        <h1>status admin</h1>
        {msg && <span className="status-admin-msg">{msg}</span>}
      </div>

      <section>
        <h2>active incidents ({data?.incidents.active.length ?? 0})</h2>
        {data?.incidents.active.length === 0 && <p className="status-admin-empty">no active incidents</p>}
        {data?.incidents.active.map((inc) => (
          <div key={inc.incidentId} className="status-admin-row">
            <div className="status-admin-row-info">
              <strong>{inc.title}</strong>
              <span className="status-admin-meta">{inc.service} · {new Date(inc.startTime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              {inc.description && <p>{inc.description}</p>}
            </div>
            <button
              className="status-admin-btn status-admin-btn-resolve"
              disabled={saving}
              onClick={() => resolveIncident(inc.incidentId)}
            >
              resolve
            </button>
          </div>
        ))}

        <h2>create incident</h2>
        <form className="status-admin-form" onSubmit={createIncident}>
          <input placeholder="title" value={incTitle} onChange={(e) => setIncTitle(e.target.value)} required />
          <input placeholder="service (e.g. Halcyon)" value={incService} onChange={(e) => setIncService(e.target.value)} required />
          <input placeholder="url (e.g. https://akn.me.uk)" value={incUrl} onChange={(e) => setIncUrl(e.target.value)} />
          <textarea placeholder="description" value={incDesc} onChange={(e) => setIncDesc(e.target.value)} rows={3} />
          <button type="submit" disabled={saving}>create</button>
        </form>
      </section>

      <section>
        <h2>monitored urls ({data?.urls.length ?? 0})</h2>
        {data?.urls.map((u) => (
          <div key={u.name} className="status-admin-row">
            <div className="status-admin-row-info">
              <strong>{u.name}</strong>
              <a href={u.url} target="_blank" rel="noreferrer" className="status-admin-meta">{u.url}</a>
            </div>
            <button
              className="status-admin-btn status-admin-btn-remove"
              disabled={saving}
              onClick={() => removeUrl(u.name)}
            >
              remove
            </button>
          </div>
        ))}

        <h2>add url</h2>
        <form className="status-admin-form" onSubmit={addUrl}>
          <input placeholder="name (e.g. Halcyon)" value={urlName} onChange={(e) => setUrlName(e.target.value)} required />
          <input placeholder="url (e.g. https://akn.me.uk)" value={urlAddr} onChange={(e) => setUrlAddr(e.target.value)} required />
          <button type="submit" disabled={saving}>add</button>
        </form>
      </section>
    </div>
  );
}
