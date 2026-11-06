import { db } from "@/lib/supabase-server";

export type NotifySource = "android" | "openclaw" | "aknclient" | "other";

export function normaliseSource(s: unknown): NotifySource {
  return s === "android" || s === "openclaw" || s === "aknclient" ? s : "other";
}

/** Stores a notification; the web client polls /api/notifications/recent to display it. */
export async function storeNotification(n: { title: string; body: string; source: NotifySource }) {
  return db.from("notifications").insert(n).select("id").single();
}
