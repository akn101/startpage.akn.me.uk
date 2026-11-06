"use client";

import { NotificationPayload } from "@/lib/notifications";

const SOURCE_CONFIG = {
  android: { label: "Android", color: "#7ec8a0", icon: "📱" },
  openclaw: { label: "openclaw", color: "#b48eff", icon: "🤖" },
  aknclient: { label: "aknClient", color: "#ffc88a", icon: "💻" },
  other:    { label: "notify",   color: "#88c8ff", icon: "🔔" },
};

interface ToastProps {
  toast: NotificationPayload;
  onDismiss: (id: string) => void;
}

function Toast({ toast, onDismiss }: ToastProps) {
  const src = SOURCE_CONFIG[toast.source];
  return (
    <div className="toast-item">
      <span className="toast-icon">{src.icon}</span>
      <div className="toast-content">
        <div className="toast-meta">
          <span className="toast-source" style={{ color: src.color }}>{src.label}</span>
          <span className="toast-title">{toast.title}</span>
        </div>
        <span className="toast-body">{toast.body}</span>
      </div>
      <button type="button" className="toast-dismiss" onClick={() => onDismiss(toast.id)}>✕</button>
    </div>
  );
}

interface Props {
  toasts: NotificationPayload[];
  onDismiss: (id: string) => void;
}

export default function NotificationToast({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}
