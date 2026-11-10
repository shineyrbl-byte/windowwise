// Decides, hour by hour, whether a window should be open or closed,
// and simulates the room temperature so we can show the benefit.

export const DEFAULT_SETTINGS = {
  comfortMin: 20, // °C: below this, outside air makes the room too cold
  comfortMax: 26, // °C: the room temperature you'd like to stay under
  aqiLimit: 100, // US AQI: above this, keep pollution out (use 50 if sensitive)
  rainLimit: 60, // % chance of rain that counts as "it will rain"
  startIndoor: null, // °C: current room temperature, if the user knows it
  sun: 'unsure', // which part of the day the window gets direct sun (see SUN_PROFILES)
  fan: false, // a fan running in the room
  closedMix: null, // calibrated: how fast heat leaks into the closed room
  sunScale: null, // calibrated: how strongly the sun heats this room
};

// Simple room model, tuned to feel plausible rather than to be exact:
// an open window pulls the room strongly toward outdoor temperature,
// a closed one leaks slowly, and the sun warms a closed room by day.
export const OPEN_MIX = 0.5;
export const FAN_OPEN_MIX = 0.65; // a fan pulls outside air through faster
export const CLOSED_MIX = 0.08;
export const FAN_FEELS_COOLER = 2; // °C: a ceiling fan's breeze feels about this much cooler

// °C of sun heating per hour, by when the window gets direct sun.
// Described by time of day rather than compass direction so it works
// in both hemispheres.
export const SUN_PROFILES = {
  morning: [[7, 12, 0.6], [12, 17, 0.2]],
  afternoon: [[9, 13, 0.2], [13, 19, 0.6]],
  allday: [[8, 17, 0.45]],
  shade: [[9, 18, 0.15]],
  unsure: [[9, 18, 0.35]],
};

// Times look like "2026-11-09T14:00" in the place's own timezone,
// so read the hour from the string instead of the browser's clock.
export const hourOf = (time) => Number(time.slice(11, 13));
export function sunGain(hour, profile = 'unsure', scale = 1) {
  const bands = SUN_PROFILES[profile] || SUN_PROFILES.unsure;
  const band = bands.find(([from, to]) => hour >= from && hour < to);
  return band ? band[2] * scale : 0;
}

// The room model's numbers for these settings.
export function modelParams(settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    openMix: s.fan ? FAN_OPEN_MIX : OPEN_MIX,
    closedMix: s.closedMix ?? CLOSED_MIX,
    sunScale: s.sunScale ?? 1,
    sun: s.sun,
  };
}

// One hour of the room model. Exported so calibration can reuse it.
export function step(indoor, outdoor, open, hour, p = modelParams()) {
  const mix = open ? p.openMix : p.closedMix;
  const sun = open ? 0 : sunGain(hour, p.sun, p.sunScale);
  return indoor + (outdoor - indoor) * mix + sun;
}

// Decide one hour given the current indoor estimate.
export function decideHour(hour, indoor, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const { temp, humidity, rainProb, aqi } = hour;

  if (rainProb != null && rainProb >= s.rainLimit) {
    return { open: false, reason: 'rain', text: `${rainProb}% chance of rain` };
  }
  if (aqi != null && aqi > s.aqiLimit) {
    return { open: false, reason: 'air', text: `Outdoor air is poor (AQI ${aqi})` };
  }
  if (temp < s.comfortMin - 1 && indoor <= s.comfortMax) {
    return { open: false, reason: 'cold', text: `Too cold outside (${round(temp)}°C)` };
  }
  if (temp <= indoor - 1) {
    if (humidity != null && humidity >= 90 && temp > s.comfortMax) {
      return { open: false, reason: 'muggy', text: `Very humid outside (${humidity}%)` };
    }
    return { open: true, reason: 'cool', text: `Outside is cooler (${round(temp)}°C)` };
  }
  if (temp >= indoor + 1) {
    return { open: false, reason: 'heat', text: `Outside is hotter (${round(temp)}°C)` };
  }
  return { open: true, reason: 'fresh', text: 'Mild outside: good time for fresh air' };
}

// Build the full plan. Returns one entry per hour with the decision,
// the room temperature if you follow the plan, and if you keep the window shut.
export function makePlan(hours, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (!hours.length) return [];
  const p = modelParams(s);
  const start = s.startIndoor ?? hours[0].temp + 3;
  let planned = start;
  let shut = start;

  return hours.map((hour) => {
    const decision = decideHour(hour, planned, s);
    const entry = { ...hour, ...decision, indoorPlan: planned, indoorShut: shut };
    planned = step(planned, hour.temp, decision.open, hourOf(hour.time), p);
    shut = step(shut, hour.temp, false, hourOf(hour.time), p);
    return entry;
  });
}

// Merge consecutive hours with the same state into blocks like
// "Open 21:00–09:00", keeping the first hour's reason.
export function toBlocks(plan) {
  const blocks = [];
  for (const h of plan) {
    const last = blocks[blocks.length - 1];
    if (last && last.open === h.open) {
      last.end = h.time;
      last.hours += 1;
    } else {
      blocks.push({ open: h.open, reason: h.reason, text: h.text, start: h.time, end: h.time, hours: 1 });
    }
  }
  return blocks;
}

// Headline numbers: the hottest the room gets with and without the plan.
export function summarize(plan) {
  if (!plan.length) return null;
  // Skip the first hour: both scenarios start at the same temperature.
  const later = plan.length > 1 ? plan.slice(1) : plan;
  const peakPlan = Math.max(...later.map((h) => h.indoorPlan));
  const peakShut = Math.max(...later.map((h) => h.indoorShut));
  const openHours = plan.filter((h) => h.open).length;
  const nextChange = plan.findIndex((h) => h.open !== plan[0].open);
  return {
    peakPlan: round(peakPlan),
    peakShut: round(peakShut),
    saved: round(Math.max(0, peakShut - peakPlan)),
    openHours,
    now: plan[0],
    nextChange: nextChange === -1 ? null : plan[nextChange],
    airHours: plan.filter((h) => h.reason === 'air').length,
    bestAir: bestAirHour(plan),
  };
}

// On bad-air days the plan may never open the window. Rooms still need
// some fresh air, so find the least-polluted dry hour to air out briefly.
// US AQI is a 24-hour average and barely moves hour to hour, so rank by
// hourly PM2.5 when we have it.
export function bestAirHour(plan) {
  const usePm = plan.some((h) => h.pm25 != null);
  const key = usePm ? 'pm25' : 'aqi';
  const candidates = plan.filter((h) => h[key] != null && h.reason !== 'rain');
  if (!candidates.length) return null;
  return candidates.reduce((best, h) => (h[key] < best[key] ? h : best));
}

export const round = (n) => Math.round(n * 10) / 10;
