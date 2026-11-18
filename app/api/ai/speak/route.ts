import { NextRequest } from "next/server";
import { requireOwner, NO_STORE } from "@/lib/auth";
import { MAX_SPEAK, pollyConfigured, synthesize } from "@/lib/speak";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Aria's voice. Body {text} → audio/mpeg (AWS Polly, neural). Owner profile only. */
export async function POST(req: NextRequest) {
  const g = await requireOwner();
  if (g instanceof Response) return g;
  let body: { text?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_SPEAK) : "";
  if (!text) return Response.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  if (!pollyConfigured()) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  try {
    const audio = await synthesize(text);
    return new Response(audio as BodyInit, { headers: { ...NO_STORE, "Content-Type": "audio/mpeg", "Content-Length": String(audio.byteLength) } });
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error("ai/speak: polly failed:", name, e instanceof Error ? e.message : e);
    return Response.json({ error: name === "AccessDeniedException" ? "tts_forbidden" : "tts_failed" }, { status: 502, headers: NO_STORE });
  }
}
