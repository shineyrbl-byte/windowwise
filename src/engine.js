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
  pollenAllergy: false, // keep the window shut when pollen is high
  crossVent: false, // windows on two sides of the room: air flows through faster
  curtains: false, // curtains or blinds closed during sunny hours
  damp: false, // damp/monsoon mode: dry the room out when outside air is drier
  gustLimit: 50, // km/h: close for wind gusts at or above this
  acKw: 1.2, // kWh an AC uses per hour of running (a typical 1.5-ton split AC)
  tariff: 8, // electricity price per kWh
  currency: '₹',
  closedMix: null, // calibrated: how fast heat leaks into the closed room
  sunScale: null, // calibrated: how strongly the sun heats this room
  openMix: null, // calibrated: how fast the room airs out with the window open
};

// Simple room model, tuned to feel plausible rather than to be exact:
// an open window pulls the room strongly toward outdoor temperature,
// a closed one leaks slowly, and the sun warms a closed room by day.
export const OPEN_MIX = 0.5;
export const FAN_OPEN_MIX = 0.65; // a fan pulls outside air through faster
export const CLOSED_MIX = 0.08;
export const FAN_FEELS_COOLER = 2; // °C: a ceiling fan's breeze feels about this much cooler
export const CROSS_MIX = 0.75; // windows on two sides: air flows straight through
export const CURTAIN_FACTOR = 0.5; // closed curtains or blinds block about half the sun heat
export const CLOUD_BLOCK = 0.7; // full cloud cover removes about 70% of sun heat
export const GRID_CO2 = 0.71; // kg CO₂ per kWh, India's grid average (CEA)

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
// Grains per m³ at which each pollen counts as "high" (symptoms likely for
// most allergy sufferers), based on common European pollen-forecast bands.
export const POLLEN_HIGH = { grass: 50, birch: 100, alder: 100, mugwort: 50, olive: 200, ragweed: 20 };
const POLLEN_NAMES = { grass: 'Grass', birch: 'Birch', alder: 'Alder', mugwort: 'Mugwort', olive: 'Olive', ragweed: 'Ragweed' };

// The pollen closest to (or furthest past) its "high" level.
export function pollenRisk(pollen) {
  if (!pollen) return null;
  let worst = null;
  for (const [type, value] of Object.entries(pollen)) {
    const ratio = value / (POLLEN_HIGH[type] || 50);
    if (!worst || ratio > worst.ratio) worst = { type, name: POLLEN_NAMES[type] || type, value, ratio };
  }
  return worst;
}

export function sunGain(hour, profile = 'unsure', scale = 1) {
  const bands = SUN_PROFILES[profile] || SUN_PROFILES.unsure;
  const band = bands.find(([from, to]) => hour >= from && hour < to);
  return band ? band[2] * scale : 0;
}

// The room model's numbers for these settings.
export function modelParams(settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    openMix: s.openMix ?? (s.crossVent ? CROSS_MIX : OPEN_MIX) + (s.fan ? FAN_OPEN_MIX - OPEN_MIX : 0),
    closedMix: s.closedMix ?? CLOSED_MIX,
    sunScale: (s.sunScale ?? 1) * (s.curtains ? CURTAIN_FACTOR : 1),
    sun: s.sun,
  };
}

// One hour of the room model. Exported so calibration can reuse it.
export function step(indoor, outdoor, open, hour, p = modelParams(), cloud = 0) {
  const mix = open ? p.openMix : p.closedMix;
  const sun = open ? 0 : sunGain(hour, p.sun, p.sunScale) * (1 - (CLOUD_BLOCK * (cloud ?? 0)) / 100);
  return indoor + (outdoor - indoor) * mix + sun;
}

// Decide one hour given the current indoor estimate.
export function decideHour(hour, indoor, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const { temp, humidity, rainProb, aqi } = hour;

  if (rainProb != null && rainProb >= s.rainLimit) {
    return { open: false, reason: 'rain', text: `${rainProb}% chance of rain` };
  }
  if (hour.gust != null && hour.gust >= s.gustLimit) {
    return { open: false, reason: 'wind', text: `Strong wind gusts (${Math.round(hour.gust)} km/h)` };
  }
  if (aqi != null && aqi > s.aqiLimit) {
    return { open: false, reason: 'air', text: `Outdoor air is poor (AQI ${aqi})` };
  }
  if (s.pollenAllergy) {
    const risk = pollenRisk(hour.pollen);
    if (risk && risk.ratio >= 1) {
      return { open: false, reason: 'pollen', text: `${risk.name} pollen is high (${Math.round(risk.value)} grains/m³)` };
    }
  }
  if (s.damp && humidity != null) {
    if (humidity >= 85) {
      return { open: false, reason: 'damp', text: `Humid outside (${humidity}%): opening would add moisture` };
    }
    if (humidity <= 65 && temp >= s.comfortMin - 1) {
      return { open: true, reason: 'dry', text: `Drier air outside (${humidity}%): good for drying the room` };
    }
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
    planned = step(planned, hour.temp, decision.open, hourOf(hour.time), p, hour.cloud);
    shut = step(shut, hour.temp, false, hourOf(hour.time), p, hour.cloud);
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
      blocks.push({ open: h.open, reason: h.reason, text: h.text, start: h.time, end: h.time, hours: 1, first: h });
    }
  }
  return blocks;
}

// Headline numbers: the hottest the room gets with and without the plan.
export function summarize(plan, settings = {}) {
  if (!plan.length) return null;
  const s = { ...DEFAULT_SETTINGS, ...settings };
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
    coldHours: plan.filter((h) => h.reason === 'cold').length,
    warmest: warmestAiringHour(plan),
    tonight: overnight(plan),
    curtains: curtainHours(plan, s),
    energy: energySaved(plan, s),
  };
}

const isNight = (time) => {
  const h = hourOf(time);
  return h >= 21 || h < 7;
};
const BLOCKING = new Set(['rain', 'wind', 'air', 'pollen']);

// The first night (21:00–07:00) in the plan, and its longest open stretch.
export function overnight(plan) {
  const startIdx = plan.findIndex((h) => isNight(h.time));
  if (startIdx === -1) return null;
  let endIdx = startIdx;
  while (endIdx + 1 < plan.length && isNight(plan[endIdx + 1].time)) endIdx++;
  const night = plan.slice(startIdx, endIdx + 1);
  let best = null;
  let run = null;
  for (const h of night) {
    if (h.open) {
      run = run ? { ...run, end: h, hours: run.hours + 1 } : { start: h, end: h, hours: 1 };
      if (!best || run.hours > best.hours) best = run;
    } else run = null;
  }
  const reasons = night.filter((h) => !h.open).map((h) => h.reason);
  const mainReason = reasons.sort((a, b) => reasons.filter((r) => r === b).length - reasons.filter((r) => r === a).length)[0];
  return {
    start: night[0],
    end: night[night.length - 1],
    hours: night.length,
    openHours: night.filter((h) => h.open).length,
    best, // longest open stretch, or null
    closedBecause: best ? null : night.find((h) => h.reason === mainReason) || null,
  };
}

// On cold days the window stays shut; air out briefly at the warmest safe hour.
export function warmestAiringHour(plan) {
  const ok = plan.filter((h) => !BLOCKING.has(h.reason));
  if (!ok.length) return null;
  return ok.reduce((best, h) => (h.temp > best.temp ? h : best));
}

// Daytime hours when the window is closed and the sun shines on it:
// closing curtains or blinds then keeps a lot of heat out.
export function curtainHours(plan, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (s.sun === 'shade') return null;
  // Only when the room is warm: on cold days, sun heat is welcome.
  const wanted = (h) =>
    !h.open && sunGain(hourOf(h.time), s.sun) > 0.25 && (h.cloud ?? 0) < 70 && h.indoorPlan > s.comfortMax - 2;
  const first = plan.findIndex(wanted);
  if (first === -1) return null;
  let last = first;
  while (last + 1 < plan.length && wanted(plan[last + 1])) last++;
  return { from: plan[first], to: plan[last], hours: last - first + 1 };
}

// Hours an AC would run to keep the room under comfortMax, with the window
// shut vs. following the plan. The difference is the AC time the plan saves.
export function energySaved(plan, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const later = plan.length > 1 ? plan.slice(1) : plan;
  const shutHot = later.filter((h) => h.indoorShut > s.comfortMax).length;
  const planHot = later.filter((h) => h.indoorPlan > s.comfortMax).length;
  const hours = Math.max(0, shutHot - planHot);
  const kwh = hours * s.acKw;
  return { hours, kwh: round(kwh), money: Math.round(kwh * s.tariff), co2: round(kwh * GRID_CO2), currency: s.currency };
}

// One summary per calendar day for the multi-day outlook.
export function daySummaries(plan) {
  const days = new Map();
  for (const h of plan) {
    const d = h.time.slice(0, 10);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(h);
  }
  return [...days.entries()].map(([date, hours]) => {
    const temps = hours.map((h) => h.temp);
    const aqis = hours.map((h) => h.aqi).filter((v) => v != null);
    const nightStart = plan.findIndex((h) => h.time.slice(0, 10) === date && hourOf(h.time) >= 21);
    return {
      date,
      hours: hours.length,
      openHours: hours.filter((h) => h.open).length,
      max: round(Math.max(...temps)),
      min: round(Math.min(...temps)),
      maxAqi: aqis.length ? Math.max(...aqis) : null,
      rainHours: hours.filter((h) => h.reason === 'rain').length,
      windHours: hours.filter((h) => h.reason === 'wind').length,
      night: nightStart === -1 ? null : overnight(plan.slice(nightStart)),
    };
  });
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

// US EPA PM2.5 AQI (2024 breakpoints), for ground-station readings.
const PM25_BANDS = [
  [0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];
export function pm25ToAqi(pm) {
  if (pm == null || !Number.isFinite(pm) || pm < 0) return null;
  const c = Math.floor(pm * 10) / 10;
  const band = PM25_BANDS.find(([lo, hi]) => c >= lo && c <= hi) || PM25_BANDS[PM25_BANDS.length - 1];
  const [lo, hi, alo, ahi] = band;
  return Math.min(500, Math.round(((ahi - alo) / (hi - lo)) * (Math.min(c, hi) - lo) + alo));
}
