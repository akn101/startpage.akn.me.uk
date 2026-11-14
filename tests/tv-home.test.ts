import { describe, expect, it } from "vitest";
import { glyphKind, greeting, upcoming, weatherAlerts, weatherLabel, type CalEvent, type Weather } from "@/app/tv/tv-logic";

// The /tv home screen's rules are ported from the native TV app (MainActivity.java); these pin them.

function wx(over: { rain?: number[]; uv?: number[]; air?: Record<string, number[]> } = {}): Weather {
  // 26 hourly slots from 08:00 today, in the forecast's local "YYYY-MM-DDTHH:mm" form.
  const times = Array.from({ length: 26 }, (_, i) => {
    const h = 8 + i, day = 14 + Math.floor(h / 24);
    return `2026-11-${day}T${String(h % 24).padStart(2, "0")}:00`;
  });
  const zero = () => times.map(() => 0);
  return {
    current: { time: "2026-11-14T08:15", temperature_2m: 10, weathercode: 3, apparent_temperature: 8 },
    hourly: {
      time: times, temperature_2m: zero(), weathercode: zero(),
      precipitation_probability: over.rain ?? zero(), uv_index: over.uv ?? zero(),
    },
    _air: over.air ? { hourly: over.air } : undefined,
  };
}
const pad = (head: number[], len = 26) => [...head, ...Array(len - head.length).fill(0)];

describe("tv weather alerts", () => {
  it("is empty when nothing matters", () => {
    expect(weatherAlerts(wx())).toEqual([]);
    expect(weatherAlerts(null)).toEqual([]);
  });
  it("rain now, easing at the first hour under 30%", () => {
    expect(weatherAlerts(wx({ rain: pad([80, 60, 20]) }))).toEqual(["Rain now, easing by 10:00"]);
  });
  it("rain on and off when it never drops under 30% in 12h", () => {
    expect(weatherAlerts(wx({ rain: Array(26).fill(60) }))).toEqual(["Rain on and off all day"]);
  });
  it("rain likely from the first hour at 50%+, with the peak", () => {
    expect(weatherAlerts(wx({ rain: pad([10, 10, 55, 70, 20]) }))).toEqual(["Rain likely from 10:00 (70%)"]);
  });
  it("UV 6+ high, 8+ very high, today only", () => {
    expect(weatherAlerts(wx({ uv: pad([1, 2, 3, 6.4]) }))).toEqual(["UV 6 high around 11:00"]);
    expect(weatherAlerts(wx({ uv: pad([8.2]) }))).toEqual(["UV 8 very high now"]);
    expect(weatherAlerts(wx({ uv: pad([5.9]) }))).toEqual([]);
  });
  it("pollen at the native thresholds, and AQI above 100/150", () => {
    expect(weatherAlerts(wx({ air: { grass_pollen: [30], birch_pollen: [49], ragweed_pollen: [20], us_aqi: [101] } })))
      .toEqual(["Grass, Ragweed pollen high", "Air quality poor (AQI 101)"]);
    expect(weatherAlerts(wx({ air: { us_aqi: [151] } }))).toEqual(["Air unhealthy (AQI 151)"]);
    expect(weatherAlerts(wx({ air: { us_aqi: [100] } }))).toEqual([]);
  });
});

describe("tv labels", () => {
  it("greets by hour", () => {
    expect(greeting(4)).toBe("Up late");
    expect(greeting(11, "A")).toBe("Good morning, A");
    expect(greeting(17)).toBe("Good afternoon");
    expect(greeting(18)).toBe("Good evening");
  });
  it("maps weather codes like native", () => {
    expect([0, 2, 3, 45, 55, 63, 75, 81, 85, 95].map(weatherLabel)).toEqual(
      ["Clear", "Partly cloudy", "Overcast", "Fog", "Drizzle", "Rain", "Snow", "Showers", "Snow showers", "Thunderstorm"]);
    expect([0, 1, 3, 45, 61, 81, 71, 95].map(glyphKind)).toEqual(["clear", "partly", "cloud", "fog", "rain", "rain", "snow", "storm"]);
  });
  it("keeps events that have not ended, soonest first; all-day lasts the whole start date", () => {
    const now = new Date(2026, 10, 14, 15, 0).getTime();
    const ev = (uid: string, start: string, end: string, allDay = false): CalEvent => ({ uid, summary: uid, start, end, allDay });
    const list = upcoming([
      ev("later", new Date(2026, 10, 15, 9).toISOString(), new Date(2026, 10, 15, 10).toISOString()),
      ev("over", new Date(2026, 10, 14, 9).toISOString(), new Date(2026, 10, 14, 10).toISOString()),
      ev("today-all-day", "2026-11-14", "2026-11-15", true),
      ev("running", new Date(2026, 10, 14, 14).toISOString(), new Date(2026, 10, 14, 16).toISOString()),
    ], now);
    expect(list.map((e) => e.uid)).toEqual(["today-all-day", "running", "later"]);
  });
});
