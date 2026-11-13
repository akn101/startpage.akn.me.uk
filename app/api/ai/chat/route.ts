import { NextRequest } from "next/server";
import { requireSensitive, NO_STORE } from "@/lib/auth";
import { chat, cleanMessages } from "@/lib/ai-chat";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Aria, the TV assistant. Body {messages:[{role,content}]} → {text, actions}. PIN-gated on the TV. */
export async function POST(req: NextRequest) {
  const g = await requireSensitive();
  if (g instanceof Response) return g;
  let body: { messages?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const messages = cleanMessages(body.messages);
  if (!messages) return Response.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  const { text, actions } = await chat(g.uid, messages);
  return Response.json({ text, actions }, { headers: NO_STORE });
}
