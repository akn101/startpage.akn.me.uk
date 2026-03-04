"use client";

import { useEffect, useState } from "react";

interface WeatherData {
  temp: number;
  windspeed: number;
  code: number;
  city?: string;
}

function interpretWeather(code: number): { emoji: string; label: string } {
  if (code === 0)  return { emoji: "☀️",  label: "Clear" };
  if (code <= 2)   return { emoji: "⛅",  label: "Partly cloudy" };
  if (code === 3)  return { emoji: "☁️",  label: "Overcast" };
  if (code <= 49)  return { emoji: "🌫️",  label: "Fog" };
  if (code <= 57)  return { emoji: "🌦️",  label: "Drizzle" };
  if (code <= 67)  return { emoji: "🌧️",  label: "Rain" };
  if (code <= 77)  return { emoji: "❄️",  label: "Snow" };
  if (code <= 82)  return { emoji: "🌦️",  label: "Showers" };
  if (code <= 86)  return { emoji: "🌨️",  label: "Snow showers" };
  if (code <= 99)  return { emoji: "⛈️",  label: "Thunderstorm" };
  return { emoji: "🌡️", label: "Unknown" };
}

async function fetchWeather(lat: number, lon: number, city?: string): Promise<WeatherData> {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m&temperature_unit=celsius`
  );
  const data = await res.json();
  return {
    temp: Math.round(data.current.temperature_2m),
    windspeed: Math.round(data.current.windspeed_10m),
    code: data.current.weathercode,
    city,
  };
}

async function fetchByIP(): Promise<WeatherData> {
  const geo = await fetch("https://ipapi.co/json/").then((r) => r.json());
  return fetchWeather(geo.latitude, geo.longitude, geo.city);
}

export default function Weather() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [denied, setDenied]   = useState(false);

  const load = () => {
    if (!navigator.geolocation) { fetchByIP().then(setWeather).catch(() => {}); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => fetchWeather(coords.latitude, coords.longitude).then(setWeather).catch(() => {}),
      () => { setDenied(true); fetchByIP().then(setWeather).catch(() => {}); }
    );
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!weather) return (
    <div className="weather-widget glass-sm">
      <span className="weather-loading">loading…</span>
    </div>
  );

  const { emoji, label } = interpretWeather(weather.code);

  return (
    <div className="weather-widget glass-sm">
      <span className="weather-emoji">{emoji}</span>
      <div className="weather-info">
        <span className="weather-temp">{weather.temp}°C</span>
        <span className="weather-meta">
          {weather.city ? `${weather.city} · ` : ""}{label} · {weather.windspeed} km/h
          {denied && (
            <button type="button" className="location-retry" onClick={load} title="Re-enable location">📍</button>
          )}
        </span>
      </div>
    </div>
  );
}
