"use client";

import { useState, useEffect } from "react";

interface WeatherData { temp: number; windspeed: number; code: number; city?: string }
interface CalEvent    { uid: string; summary: string; start: string; end: string; allDay: boolean }
interface Alarm       { id: string; time: string; label: string; enabled: boolean }
interface Todo        { id: string; text: string; done: boolean }
interface Assignment  { title: string; status: string; due: string; subject?: string }

function weatherSymbol(code: number): string {
  if (code === 0)  return "○";
  if (code <= 2)   return "◑";
  if (code === 3)  return "●";
  if (code <= 49)  return "≋";
  if (code <= 57)  return "·";
  if (code <= 67)  return "▽";
  if (code <= 77)  return "❄";
  if (code <= 82)  return "▿";
  if (code <= 99)  return "↯";
  return "—";
}
function weatherLabel(code: number): string {
  if (code === 0)  return "Clear";
  if (code <= 2)   return "Partly cloudy";
  if (code === 3)  return "Overcast";
  if (code <= 49)  return "Fog";
  if (code <= 57)  return "Drizzle";
  if (code <= 67)  return "Rain";
  if (code <= 77)  return "Snow";
  if (code <= 82)  return "Showers";
  if (code <= 99)  return "Thunderstorm";
  return "—";
}

async function loadWeather(): Promise<WeatherData> {
  return new Promise((resolve, reject) => {
    const byCoords = (lat: number, lon: number, city?: string) =>
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m&temperature_unit=celsius`)
        .then((r) => r.json())
        .then((d) => resolve({ temp: Math.round(d.current.temperature_2m), windspeed: Math.round(d.current.windspeed_10m), code: d.current.weathercode, city }))
        .catch(reject);
    const byIP = () => fetch("https://ipapi.co/json/").then((r) => r.json()).then((geo) => byCoords(geo.latitude, geo.longitude, geo.city)).catch(reject);
    if (!navigator.geolocation) { byIP(); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => byCoords(coords.latitude, coords.longitude), () => byIP());
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function sameDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function MorningPanel() {
  const [now, setNow]               = useState(new Date());
  const [weather, setWeather]       = useState<WeatherData | null>(null);
  const [events, setEvents]         = useState<CalEvent[]>([]);
  const [nextAlarm, setNextAlarm]   = useState<Alarm | null>(null);
  const [todoCt, setTodoCt]         = useState<number | null>(null);
  const [assignCt, setAssignCt]     = useState<number | null>(null);
  const [overdueAssign, setOverdue] = useState(0);
  const [updated, setUpdated]       = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    const [w, cal, alarms, todos, assigns] = await Promise.allSettled([
      loadWeather(),
      fetch("/api/integrations/calendar").then((r) => r.json()),
      fetch("/api/data/alarms").then((r) => r.json()),
      fetch("/api/data/todos").then((r) => r.json()),
      fetch("/api/assignments").then((r) => r.json()),
    ]);
    if (w.status === "fulfilled") setWeather(w.value);
    if (cal.status === "fulfilled") {
      const raw = cal.value;
      setEvents(Array.isArray(raw) ? raw : (raw.events ?? []));
    }
    if (alarms.status === "fulfilled") {
      const raw = alarms.value;
      const list: Alarm[] = Array.isArray(raw) ? raw : (raw.alarms ?? []);
      const enabled = list.filter((a) => a.enabled).sort((a, b) => a.time.localeCompare(b.time));
      setNextAlarm(enabled[0] ?? null);
    }
    if (todos.status === "fulfilled") {
      const raw = todos.value;
      const list: Todo[] = Array.isArray(raw) ? raw : (raw.todos ?? []);
      setTodoCt(list.filter((t) => !t.done).length);
    }
    if (assigns.status === "fulfilled") {
      const raw = assigns.value;
      const list: Assignment[] = Array.isArray(raw) ? raw : (raw.assignments ?? []);
      const pending = list.filter((a) => !["Complete", "Marked", "Archived"].includes(a.status));
      const overdue = pending.filter((a) => a.due && new Date(a.due).getTime() < Date.now()).length;
      const dueWeek = pending.filter((a) => a.due && daysUntil(a.due) <= 7).length;
      setOverdue(overdue);
      setAssignCt(dueWeek);
    }
    setUpdated(new Date());
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const today    = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const d2 = new Date(now); d2.setDate(d2.getDate() + 2);
  const d3 = new Date(now); d3.setDate(d3.getDate() + 3);

  const todayEvents    = events.filter((e) => sameDay(e.start, today));
  const tomEvents      = events.filter((e) => sameDay(e.start, tomorrow));
  const d2Events       = events.filter((e) => sameDay(e.start, d2));
  const d3Events       = events.filter((e) => sameDay(e.start, d3));

  // How many extra days to show to fill space
  const showD2 = todayEvents.length + tomEvents.length < 6;
  const showD3 = showD2 && todayEvents.length + tomEvents.length + d2Events.length < 6;

  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const secStr  = String(now.getSeconds()).padStart(2, "0");
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const updStr  = updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  function dayLabel(ref: Date): string {
    return ref.toLocaleDateString("en-GB", { weekday: "long" });
  }

  function EventList({ evts, label }: { evts: CalEvent[]; label: string }) {
    if (evts.length === 0) return null;
    return (
      <div>
        <div className="display-section-header">{label}</div>
        {evts.slice(0, 5).map((e) => (
          <div key={e.uid} className="display-list-item">
            <span className="display-list-item-dot">
              {e.allDay ? "all day" : fmtTime(e.start)}
            </span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.summary}
            </span>
          </div>
        ))}
        {evts.length > 5 && (
          <div className="display-label" style={{ paddingLeft: "3.5rem", marginTop: "0.1rem" }}>+{evts.length - 5} more</div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="display-title-bar">
        <div className="display-title-bar-left">Morning Brief</div>
        <div className="display-title-bar-right">startpage · {updStr}</div>
      </div>

      <div className="display-content display-morning-layout">
        {/* Clock */}
        <div className="display-morning-top">
          <div className="display-time-large">
            {timeStr}
            <span style={{ fontSize: "30%", color: "#aaa", marginLeft: "0.2em" }}>{secStr}</span>
          </div>
          <div className="display-date">{dateStr}</div>
        </div>

        {/* Weather — more prominent */}
        {weather && (
          <div className="display-morning-weather">
            <span className="display-morning-weather-main">
              {weatherSymbol(weather.code)} {weather.temp}°C
            </span>
            <span className="display-morning-weather-detail">
              {weatherLabel(weather.code)}{weather.city ? ` · ${weather.city}` : ""} · {weather.windspeed} km/h
            </span>
          </div>
        )}

        {/* Calendar — flex-1 to absorb space */}
        <div className="display-morning-events">
          <EventList evts={todayEvents} label="Today" />
          <EventList evts={tomEvents}   label="Tomorrow" />
          {showD2 && <EventList evts={d2Events} label={dayLabel(d2)} />}
          {showD3 && <EventList evts={d3Events} label={dayLabel(d3)} />}
          {todayEvents.length === 0 && tomEvents.length === 0 && (
            <div className="display-label">No upcoming events</div>
          )}
        </div>

        {/* Bottom stats bar */}
        <div className="display-morning-stats">
          {todoCt !== null && (
            <div className="display-morning-stat">
              <div className="display-morning-stat-val">{todoCt}</div>
              <div className="display-morning-stat-label">todos</div>
            </div>
          )}
          {assignCt !== null && (
            <div className={`display-morning-stat${overdueAssign > 0 ? " display-morning-stat--warn" : ""}`}>
              <div className="display-morning-stat-val">{assignCt}</div>
              <div className="display-morning-stat-label">
                {overdueAssign > 0 ? `due · ${overdueAssign} overdue` : "due this week"}
              </div>
            </div>
          )}
          {nextAlarm && (
            <div className="display-morning-stat">
              <div className="display-morning-stat-val">{nextAlarm.time}</div>
              <div className="display-morning-stat-label">
                {nextAlarm.label || "next alarm"}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
