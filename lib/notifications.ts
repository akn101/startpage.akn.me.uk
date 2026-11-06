export interface NotificationPayload {
  id: string;
  title: string;
  body: string;
  source: "android" | "openclaw" | "aknclient" | "other";
  timestamp: number;
}
