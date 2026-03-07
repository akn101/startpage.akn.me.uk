"use client";

import { useEffect, useState, useCallback } from "react";
import { Command } from "cmdk";
import { quickLinks } from "@/lib/config";
import { useTimeTracker, fmtDuration } from "@/context/TimeTrackerContext";

interface Props {
  onAddTodo: (text: string) => void;
  cameraEnabled: boolean;
  onCameraToggle: () => void;
}

function parseAlarmCommand(input: string): { time: string; label: string } | null {
  const m = input.match(/^\/alarm\s+(\d{1,2}:\d{2})(.*)?$/i);
  if (!m) return null;
  return { time: m[1].padStart(5, "0"), label: (m[2] ?? "").trim() };
}

export default function CommandPalette({ onAddTodo, cameraEnabled, onCameraToggle }: Props) {
  const [open, setOpen]   = useState(false);
  const [input, setInput] = useState("");
  const tracker = useTimeTracker();

  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    // openCommandPalette event: supports optional prefill from detail
    const paletteHandler = (e: Event) => {
      const prefill = (e as CustomEvent<{ prefill?: string }>).detail?.prefill;
      setOpen(true);
      if (prefill) setInput(prefill);
    };
    document.addEventListener("keydown", keyHandler);
    window.addEventListener("openCommandPalette", paletteHandler);
    return () => {
      document.removeEventListener("keydown", keyHandler);
      window.removeEventListener("openCommandPalette", paletteHandler);
    };
  }, []);

  const close = useCallback(() => { setOpen(false); setInput(""); }, []);

  const isTodo   = input.toLowerCase().startsWith("/todo ");
  const todoText = input.replace(/^\/todo\s*/i, "").trim();
  const handleAddTodo = useCallback(() => {
    if (todoText) { onAddTodo(todoText); close(); }
  }, [todoText, onAddTodo, close]);

  const isRecord   = input.toLowerCase().startsWith("/record");
  const recordText = input.replace(/^\/record\s*/i, "").trim();

  const isAlarm     = input.toLowerCase().startsWith("/alarm");
  const alarmParsed = parseAlarmCommand(input);

  const isDim    = input.toLowerCase().startsWith("/dim");
  const dimLevels: { label: string; value: 0 | 25 | 50 | 75 | 90 }[] = [
    { label: "Off",  value: 0  },
    { label: "25%",  value: 25 },
    { label: "50%",  value: 50 },
    { label: "75%",  value: 75 },
    { label: "90%",  value: 90 },
  ];

  const isCamera = input.toLowerCase().startsWith("/camera");

  const plainText  = input.trim();
  const isCommand  = plainText.startsWith("/");
  const showGoogle = plainText.length > 0 && !isCommand;

  const handleGoogle = useCallback(() => {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(plainText)}`, "_blank");
    close();
  }, [plainText, close]);

  const suppressFilter = isTodo || isRecord || isAlarm || isDim || isCamera;

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <Command className="cmdk-dialog" shouldFilter={!suppressFilter} loop>
        <Command.Input
          placeholder="Search Google, or /todo · /record · /alarm · /camera…"
          value={input}
          onValueChange={setInput}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && showGoogle) { e.preventDefault(); handleGoogle(); }
          }}
        />
        <Command.List>
          <Command.Empty>No results</Command.Empty>

          {showGoogle && (
            <Command.Group heading="Web">
              <Command.Item value={`google-${plainText}`} onSelect={handleGoogle}>
                <span className="cmdk-icon">⌕</span>
                Search Google for &quot;{plainText}&quot;
              </Command.Item>
            </Command.Group>
          )}

          {isTodo && todoText && (
            <Command.Group heading="Tasks">
              <Command.Item value="add-todo" onSelect={handleAddTodo}>
                <span className="cmdk-icon">＋</span>
                Add &quot;{todoText}&quot; to todos
              </Command.Item>
            </Command.Group>
          )}

          {isRecord && (
            <Command.Group heading="Timer">
              {recordText && (
                <Command.Item value="record-start" onSelect={() => { tracker.start(recordText); close(); }}>
                  <span className="cmdk-icon">▶</span>
                  Start &quot;{recordText}&quot;{tracker.running ? " (alongside current)" : ""}
                </Command.Item>
              )}
              {tracker.timers.map((t) => (
                <Command.Item key={t.id} value={`stop-${t.id}`} onSelect={() => { tracker.stop(t.id); close(); }}>
                  <span className="cmdk-icon">⏹</span>
                  Stop &quot;{t.label}&quot; ({fmtDuration(t.elapsed)})
                </Command.Item>
              ))}
              {tracker.timers.length > 1 && (
                <Command.Item value="record-stop-all" onSelect={() => { tracker.stopAll(); close(); }}>
                  <span className="cmdk-icon">⏹</span>
                  Stop all ({tracker.timers.length} timers)
                </Command.Item>
              )}
              {!recordText && !tracker.running && (
                <Command.Item value="record-hint" onSelect={() => setInput("/record ")}>
                  <span className="cmdk-icon">▶</span>
                  /record what you are working on
                </Command.Item>
              )}
            </Command.Group>
          )}

          {isAlarm && (
            <Command.Group heading="Alarm">
              {alarmParsed ? (
                <Command.Item value="alarm-set" onSelect={() => {
                  window.dispatchEvent(new CustomEvent("addAlarm", { detail: alarmParsed }));
                  close();
                }}>
                  <span className="cmdk-icon">⏰</span>
                  Set alarm for {alarmParsed.time}{alarmParsed.label ? ` — ${alarmParsed.label}` : ""}
                </Command.Item>
              ) : (
                <Command.Item value="alarm-hint" onSelect={() => setInput("/alarm ")}>
                  <span className="cmdk-icon">⏰</span>
                  /alarm HH:MM optional-label
                </Command.Item>
              )}
            </Command.Group>
          )}

          {isDim && (
            <Command.Group heading="Dim">
              {dimLevels.map(({ label, value }) => (
                <Command.Item key={value} value={`dim-${value}`} onSelect={() => {
                  window.dispatchEvent(new CustomEvent("setDim", { detail: value }));
                  close();
                }}>
                  <span className="cmdk-icon">🌙</span>
                  {label === "Off" ? "Dim off" : `Dim to ${label}`}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {isCamera && (
            <Command.Group heading="Camera">
              <Command.Item value="camera-toggle" onSelect={() => { onCameraToggle(); close(); }}>
                <span className="cmdk-icon">📷</span>
                {cameraEnabled ? "Disable camera monitoring" : "Enable camera monitoring"}
              </Command.Item>
            </Command.Group>
          )}

          {!isTodo && !isRecord && !isAlarm && !isDim && !isCamera && (
            <Command.Group heading="Go to">
              {quickLinks.map((link) => (
                <Command.Item
                  key={link.url}
                  value={link.label}
                  onSelect={() => { window.open(link.url, "_blank"); close(); }}
                >
                  <span className="cmdk-icon">↗</span>
                  {link.label}
                  <span className="cmdk-shortcut">{new URL(link.url).hostname}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {!isTodo && !isRecord && !isAlarm && !isDim && !isCamera && (
            <Command.Group heading="Actions">
              <Command.Item value="add todo" onSelect={() => setInput("/todo ")}>
                <span className="cmdk-icon">＋</span>
                Add todo
                <span className="cmdk-shortcut">/todo</span>
              </Command.Item>
              <Command.Item value="record timer" onSelect={() => setInput("/record ")}>
                <span className="cmdk-icon">▶</span>
                {tracker.timers.length > 0 ? `${tracker.timers.length} active timer(s)` : "Start recording"}
                <span className="cmdk-shortcut">/record</span>
              </Command.Item>
              <Command.Item value="set alarm" onSelect={() => setInput("/alarm ")}>
                <span className="cmdk-icon">⏰</span>
                Set alarm
                <span className="cmdk-shortcut">/alarm</span>
              </Command.Item>
              <Command.Item value="dim screen" onSelect={() => setInput("/dim ")}>
                <span className="cmdk-icon">🌙</span>
                Dim screen
                <span className="cmdk-shortcut">/dim</span>
              </Command.Item>
              <Command.Item value="toggle camera" onSelect={() => { onCameraToggle(); close(); }}>
                <span className="cmdk-icon">📷</span>
                {cameraEnabled ? "Disable camera" : "Enable camera"}
                <span className="cmdk-shortcut">/camera</span>
              </Command.Item>
              <Command.Item value="clear done" onSelect={() => {
                window.dispatchEvent(new CustomEvent("clearDoneTodos")); close();
              }}>
                <span className="cmdk-icon">✓</span>
                Clear completed todos
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
