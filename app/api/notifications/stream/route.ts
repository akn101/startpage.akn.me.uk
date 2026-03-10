import { NextRequest } from "next/server";
import {
  registerClient,
  unregisterClient,
  broadcastPing,
} from "@/lib/notifications";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  const id = randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const write = (data: string) => {
        controller.enqueue(encoder.encode(data));
      };

      registerClient(id, write);

      // Send initial connected event
      write(`data: ${JSON.stringify({ type: "connected", id })}\n\n`);

      // Ping every 30s to keep connection alive
      const pingInterval = setInterval(() => {
        try {
          broadcastPing();
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Cleanup on disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(pingInterval);
        unregisterClient(id);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
