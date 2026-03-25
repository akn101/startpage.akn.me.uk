"use client";

import { useState, useEffect } from "react";

interface WeatherData {
  temp: number;
  windspeed: number;
  code: number;
  city?: string;
}

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
  return "Unknown";
}

async function loadWeather(): Promise<WeatherData> {
  return new Promise((resolve, reject) => {
    const byCoords = (lat: number, lon: number, city?: string) =>
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m&temperature_unit=celsius`
      )
        .then((r) => r.json())
        .then((d) =>
          resolve({
            temp: Math.round(d.current.temperature_2m),
            windspeed: Math.round(d.current.windspeed_10m),
            code: d.current.weathercode,
            city,
          })
        )
        .catch(reject);

    const byIP = () =>
      fetch("https://ipapi.co/json/")
        .then((r) => r.json())
        .then((geo) => byCoords(geo.latitude, geo.longitude, geo.city))
        .catch(reject);

    if (!navigator.geolocation) { byIP(); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => byCoords(coords.latitude, coords.longitude),
      () => byIP()
    );
  });
}

interface CalEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
}

interface Alarm {
  id: string;
  time: string;
  label: string;
  enabled: boolean;
}

function fmtEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate();
}

export default function MorningPanel() {
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [nextAlarm, setNextAlarm] = useState<Alarm | null>(null);
  const [updated, setUpdated] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    const [w, cal, alarms] = await Promise.allSettled([
      loadWeather(),
      fetch("/api/integrations/calendar").then((r) => r.json()),
      fetch("/api/data/alarms").then((r) => r.json()),
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
    setUpdated(new Date());
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayEvents = events.filter((e) => sameDay(e.start, today)).slice(0, 5);
  const tomorrowEvents = events.filter((e) => sameDay(e.start, tomorrow)).slice(0, 3);

  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const secStr = String(now.getSeconds()).padStart(2, "0");
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const updStr = updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="display-title-bar">
        <div className="display-title-bar-left">Morning Brief</div>
        <div className="display-title-bar-right">startpage · {updStr}</div>
      </div>

      <div className="display-content">
        <div>
          <div className="display-time-large">
            {timeStr}<span style={{ fontSize: "40%", color: "#888", marginLeft: "0.2em" }}>{secStr}</span>
          </div>
          <div className="display-date">{dateStr}</div>
        </div>

        {weather && (
          <div className="display-row">
            <span className="display-label">Weather</span>
            <span className="display-value">
              {weatherSymbol(weather.code)} {weather.temp}°C · {weatherLabel(weather.code)} · {weather.windspeed} km/h
              {weather.city ? ` · ${weather.city}` : ""}
            </span>
          </div>
        )}

        {nextAlarm && (
          <div className="display-row">
            <span className="display-label">Next alarm</span>
            <span className="display-value">
              {nextAlarm.time}{nextAlarm.label ? ` — ${nextAlarm.label}` : ""}
            </span>
          </div>
        )}

        {todayEvents.length > 0 && (
          <div>
            <div className="display-section-header">Today</div>
            {todayEvents.map((e) => (
              <div key={e.uid} className="display-list-item">
                <span className="display-list-item-dot">{e.allDay ? "all day" : fmtEventTime(e.start)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.summary}
                </span>
              </div>
            ))}
          </div>
        )}

        {tomorrowEvents.length > 0 && (
          <div>
            <div className="display-section-header">Tomorrow</div>
            {tomorrowEvents.map((e) => (
              <div key={e.uid} className="display-list-item">
                <span className="display-list-item-dot">{e.allDay ? "all day" : fmtEventTime(e.start)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.summary}
                </span>
              </div>
            ))}
          </div>
        )}

        {todayEvents.length === 0 && tomorrowEvents.length === 0 && events.length === 0 && (
          <div className="display-label">No upcoming events</div>
        )}
      </div>
    </>
  );
}
