// Decides, hour by hour, whether a window should be open or closed,
// and simulates the room temperature so we can show the benefit.

export const DEFAULT_SETTINGS = {
  comfortMin: 20, // °C: below this, outside air makes the room too cold
  comfortMax: 26, // °C: the room temperature you'd like to stay under
  aqiLimit: 100, // US AQI: above this, keep pollution out (use 50 if sensitive)
  rainLimit: 60, // % chance of rain that counts as "it will rain"
  startIndoor: null, // °C: current room temperature, if the user knows it
};

// Simple room model, tuned to feel plausible rather than to be exact:
// an open window pulls the room strongly toward outdoor temperature,
// a closed one leaks slowly, and the sun warms a closed room by day.
const OPEN_MIX = 0.5;
const CLOSED_MIX = 0.08;
const SUN_GAIN = 0.35; // °C per daytime hour

const isDaytime = (time) => {
  const h = new Date(time).getHours();
  return h >= 9 && h < 18;
};

const step = (indoor, outdoor, open, time) => {
  const mix = open ? OPEN_MIX : CLOSED_MIX;
  const sun = !open && isDaytime(time) ? SUN_GAIN : 0;
  return indoor + (outdoor - indoor) * mix + sun;
};

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
  const start = s.startIndoor ?? hours[0].temp + 3;
  let planned = start;
  let shut = start;

  return hours.map((hour) => {
    const decision = decideHour(hour, planned, s);
    const entry = { ...hour, ...decision, indoorPlan: planned, indoorShut: shut };
    planned = step(planned, hour.temp, decision.open, hour.time);
    shut = step(shut, hour.temp, false, hour.time);
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
  };
}

export const round = (n) => Math.round(n * 10) / 10;
