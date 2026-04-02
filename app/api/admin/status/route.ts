import { isAdmin } from "@/lib/auth";

const REPO = "akn101/status.akn.me.uk";
const API = "https://api.github.com";

async function ghGet(path: string) {
  const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  return res.json();
}

async function ghPut(path: string, content: string, sha: string, message: string) {
  const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      sha,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${path} failed: ${res.status} ${JSON.stringify(err)}`);
  }
  return res.json();
}

// GET — fetch incidents + urls
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [incFile, urlFile] = await Promise.all([
    ghGet("incidents.json"),
    ghGet("urls.cfg"),
  ]);

  const incidents = JSON.parse(Buffer.from(incFile.content, "base64").toString());
  const urlsRaw = Buffer.from(urlFile.content, "base64").toString();
  const urls = urlsRaw.split("\n").filter(Boolean).map((line: string) => {
    const [name, url] = line.split("=");
    return { name: name.trim(), url: url?.trim() };
  }).filter((u: { name: string; url: string }) => u.name && u.url);

  return Response.json({
    incidents,
    incidentsSha: incFile.sha,
    urls,
    urlsSha: urlFile.sha,
    urlsRaw,
  });
}

// POST — create incident / add URL
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  if (body.type === "incident") {
    const { title, description, service, url, sha } = body;
    const incFile = await ghGet("incidents.json");
    const incidents = JSON.parse(Buffer.from(incFile.content, "base64").toString());
    const now = new Date().toISOString();
    const incident = {
      incidentId: `${service}-${now}`,
      date: now.split("T")[0],
      startTime: now,
      endTime: now,
      title,
      description,
      service,
      url,
      status: "investigating",
    };
    incidents.active.unshift(incident);
    await ghPut("incidents.json", JSON.stringify(incidents, null, 2), incFile.sha, `incident: ${title}`);
    return Response.json({ ok: true, incident });
  }

  if (body.type === "url") {
    const { name, url, sha } = body;
    const urlFile = await ghGet("urls.cfg");
    const current = Buffer.from(urlFile.content, "base64").toString();
    const updated = current.trimEnd() + `\n${name}=${url}\n`;
    await ghPut("urls.cfg", updated, urlFile.sha, `urls: add ${name}`);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown type" }, { status: 400 });
}

// PATCH — resolve incident / update incident
export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { incidentId, action, updates } = await req.json();
  const incFile = await ghGet("incidents.json");
  const incidents = JSON.parse(Buffer.from(incFile.content, "base64").toString());

  const idx = incidents.active.findIndex((i: { incidentId: string }) => i.incidentId === incidentId);
  if (idx === -1) return Response.json({ error: "Incident not found" }, { status: 404 });

  const incident = incidents.active[idx];

  if (action === "resolve") {
    const now = new Date();
    const resolved = {
      ...incident,
      endTime: now.toISOString(),
      resolved: `${now.toUTCString()} - Service restored`,
    };
    delete (resolved as Record<string, unknown>).status;
    incidents.active.splice(idx, 1);
    incidents.resolved.unshift(resolved);
    await ghPut("incidents.json", JSON.stringify(incidents, null, 2), incFile.sha, `incident resolved: ${incident.title}`);
    return Response.json({ ok: true });
  }

  if (action === "update") {
    incidents.active[idx] = { ...incident, ...updates };
    await ghPut("incidents.json", JSON.stringify(incidents, null, 2), incFile.sha, `incident update: ${incident.title}`);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

// DELETE — remove URL
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  const urlFile = await ghGet("urls.cfg");
  const current = Buffer.from(urlFile.content, "base64").toString();
  const updated = current.split("\n").filter((l) => !l.startsWith(`${name}=`)).join("\n");
  await ghPut("urls.cfg", updated, urlFile.sha, `urls: remove ${name}`);
  return Response.json({ ok: true });
}
