// Fetches weather + air quality from Open-Meteo (free, no API key)
// and merges them into one list of hourly records.

import { toEpoch } from './notify.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const POLLEN_TYPES = ['grass', 'birch', 'alder', 'mugwort', 'olive', 'ragweed'];

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';

export async function searchPlaces(name, fetchFn = fetch) {
  if (!name.trim()) return [];
  const url = `${GEO}?name=${encodeURIComponent(name.trim())}&count=6&language=en&format=json`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error('Place search failed');
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

// Pure merge step, kept separate so it can be tested without the network.
// Times are local to the place (timezone=auto), e.g. "2026-11-09T14:00".
export function mergeHourly(weather, air, hours = 24) {
  const w = weather.hourly;
  const nowHour = (weather.current?.time || w.time[0]).slice(0, 13);
  let start = w.time.findIndex((t) => t.slice(0, 13) === nowHour);
  if (start === -1) start = 0;

  const aqiByTime = new Map();
  if (air?.hourly) {
    air.hourly.time.forEach((t, i) => {
      const pollen = {};
      for (const type of POLLEN_TYPES) {
        const v = air.hourly[`${type}_pollen`]?.[i];
        if (v != null) pollen[type] = v;
      }
      aqiByTime.set(t, {
        aqi: air.hourly.us_aqi[i],
        pm25: air.hourly.pm2_5[i],
        // Pollen is only modelled for Europe; elsewhere it stays null.
        pollen: Object.keys(pollen).length ? pollen : null,
      });
    });
  }

  return w.time.slice(start, start + hours).map((time, k) => {
    const i = start + k;
    const a = aqiByTime.get(time) || {};
    return {
      time,
      temp: w.temperature_2m[i],
      feels: w.apparent_temperature[i],
      humidity: w.relative_humidity_2m[i],
      rainProb: w.precipitation_probability[i],
      wind: w.wind_speed_10m[i],
      aqi: a.aqi ?? null,
      pm25: a.pm25 ?? null,
      pollen: a.pollen ?? null,
    };
  });
}

export async function fetchHours(lat, lon, fetchFn = fetch) {
  const q = `latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=2`;
  const weatherUrl =
    `${FORECAST}?${q}&past_days=1&current=temperature_2m` +
    '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,wind_speed_10m';
  const airUrl = `${AIR}?${q}&hourly=us_aqi,pm2_5,${POLLEN_TYPES.map((t) => `${t}_pollen`).join(',')}`;

  const [wRes, aRes] = await Promise.all([fetchFn(weatherUrl), fetchFn(airUrl).catch(() => null)]);
  if (!wRes.ok) throw new Error('Weather forecast is unavailable right now');
  const weather = await wRes.json();
  // Air quality is optional: the plan still works on weather alone.
  const air = aRes && aRes.ok ? await aRes.json() : null;
  const offset = weather.utc_offset_seconds ?? 0;
  return {
    hours: mergeHourly(weather, air),
    // Every hour including yesterday, used to calibrate against past readings.
    series: weather.hourly.time.map((t, i) => ({
      at: toEpoch(t, offset),
      hour: Number(t.slice(11, 13)),
      temp: weather.hourly.temperature_2m[i],
    })),
    timezone: weather.timezone,
    utcOffset: weather.utc_offset_seconds ?? 0,
    hasAir: !!air,
  };
}
