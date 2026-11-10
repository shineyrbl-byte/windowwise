// Tunes the room model to a real room from a few thermometer readings.
//
// Each reading is { at: epoch ms, temp: °C, open: was the window mostly open
// since the previous reading }. For every pair of readings 1–12 hours apart we
// replay the model through the real outdoor temperatures for those hours and
// pick the settings that land closest to the second reading.

import { step, modelParams } from './engine.js';

const HOUR = 3600 * 1000;
export const MIN_GAP = 1 * HOUR;
export const MAX_GAP = 12 * HOUR;
// One gap can't tell sun heating apart from heat leaking in, so wait for two.
export const MIN_PAIRS = 2;
// Small pull toward typical values so a few noisy readings can't produce
// an extreme room (in °C² of error per unit of relative change).
const PRIOR_WEIGHT = 0.02;

const range = (from, to, by) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += by) out.push(Math.round(v * 1000) / 1000);
  return out;
};

// series: [{ at: epoch ms of the hour start, temp, hour: local hour 0–23 }]
export function usablePairs(readings) {
  const sorted = [...readings].sort((a, b) => a.at - b.at);
  const pairs = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].at - sorted[i - 1].at;
    if (gap >= MIN_GAP && gap <= MAX_GAP) pairs.push([sorted[i - 1], sorted[i]]);
  }
  return pairs;
}

export function replay(from, to, series, params) {
  const byHour = new Map(series.map((s) => [Math.floor(s.at / HOUR), s]));
  const steps = Math.round((to.at - from.at) / HOUR);
  let indoor = from.temp;
  const startHour = Math.floor(from.at / HOUR);
  for (let k = 0; k < steps; k++) {
    const out = byHour.get(startHour + k);
    if (!out) return null; // no weather data for this hour
    indoor = step(indoor, out.temp, to.open, out.hour, params);
  }
  return indoor;
}

function prior(c, base) {
  let p = 0;
  if (c.closedMix != null) p += ((c.closedMix - base.closedMix) / base.closedMix) ** 2;
  if (c.sunScale != null) p += (c.sunScale - 1) ** 2;
  if (c.openMix != null) p += ((c.openMix - base.openMix) / base.openMix) ** 2;
  return PRIOR_WEIGHT * p;
}

function bestFit(pairs, series, base, grid) {
  let best = null;
  for (const candidate of grid) {
    const params = { ...base, ...candidate };
    let err = 0;
    let n = 0;
    for (const [a, b] of pairs) {
      const sim = replay(a, b, series, params);
      if (sim == null) continue;
      err += (sim - b.temp) ** 2;
      n++;
    }
    const score = n ? err / n + prior(candidate, base) : Infinity;
    if (n && (!best || score < best.err)) best = { ...candidate, err: score, n };
  }
  return best;
}

// Returns calibrated settings plus how many readings pairs were used,
// or null if there isn't enough data yet.
export function calibrate(readings, series, settings = {}) {
  const base = modelParams(settings);
  const pairs = usablePairs(readings);
  if (pairs.length < MIN_PAIRS) return null;
  const closed = pairs.filter(([, b]) => !b.open);
  const open = pairs.filter(([, b]) => b.open);
  const result = {};

  if (closed.length >= MIN_PAIRS) {
    const grid = [];
    for (const closedMix of range(0.02, 0.25, 0.01)) {
      for (const sunScale of range(0, 2.2, 0.1)) grid.push({ closedMix, sunScale });
    }
    const fit = bestFit(closed, series, base, grid);
    if (fit) Object.assign(result, { closedMix: fit.closedMix, sunScale: fit.sunScale, closedPairs: fit.n });
  }
  if (open.length >= MIN_PAIRS) {
    const grid = range(0.15, 0.95, 0.05).map((openMix) => ({ openMix }));
    const fit = bestFit(open, series, { ...base, ...result }, grid);
    if (fit) Object.assign(result, { openMix: fit.openMix, openPairs: fit.n });
  }
  return Object.keys(result).length ? result : null;
}

// How a calibrated room compares to the default, as message keys
// (translated by the interface; see i18n.js).
export function describeKeys(cal, defaults = modelParams({})) {
  if (!cal) return [];
  const keys = [];
  if (cal.closedMix != null) {
    const r = cal.closedMix / defaults.closedMix;
    keys.push(r > 1.25 ? 'leak_fast' : r < 0.8 ? 'leak_slow' : 'leak_avg');
  }
  if (cal.sunScale != null) keys.push(cal.sunScale > 1.3 ? 'sun_high' : cal.sunScale < 0.7 ? 'sun_low' : 'sun_avg');
  if (cal.openMix != null) {
    const r = cal.openMix / defaults.openMix;
    keys.push(r > 1.2 ? 'air_fast' : r < 0.8 ? 'air_slow' : 'air_avg');
  }
  return keys;
}

const ENGLISH = {
  leak_fast: 'lets heat in faster than average when closed',
  leak_slow: 'holds its temperature well when closed',
  leak_avg: 'leaks heat at an average rate',
  sun_high: 'gets a lot of sun heat',
  sun_low: 'gets little sun heat',
  sun_avg: 'gets a typical amount of sun',
  air_fast: 'airs out quickly',
  air_slow: 'airs out slowly',
  air_avg: 'airs out at a normal pace',
};

// English sentence, used by tests and as a fallback.
export function describe(cal) {
  const keys = describeKeys(cal);
  return keys.length ? `Your room ${keys.map((k) => ENGLISH[k]).join(', ')}.` : '';
}
