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
    if (n && (!best || err / n < best.err)) best = { ...candidate, err: err / n, n };
  }
  return best;
}

// Returns calibrated settings plus how many readings pairs were used,
// or null if there isn't enough data yet.
export function calibrate(readings, series, settings = {}) {
  const base = modelParams(settings);
  const pairs = usablePairs(readings);
  const closed = pairs.filter(([, b]) => !b.open);
  const open = pairs.filter(([, b]) => b.open);
  const result = {};

  if (closed.length) {
    const grid = [];
    for (const closedMix of range(0.02, 0.25, 0.01)) {
      for (const sunScale of range(0, 3, 0.1)) grid.push({ closedMix, sunScale });
    }
    const fit = bestFit(closed, series, base, grid);
    if (fit) Object.assign(result, { closedMix: fit.closedMix, sunScale: fit.sunScale, closedPairs: fit.n });
  }
  if (open.length) {
    const grid = range(0.15, 0.95, 0.05).map((openMix) => ({ openMix }));
    const fit = bestFit(open, series, { ...base, ...result }, grid);
    if (fit) Object.assign(result, { openMix: fit.openMix, openPairs: fit.n });
  }
  return Object.keys(result).length ? result : null;
}

// Plain-language description of a calibrated room compared to the default.
export function describe(cal, defaults = modelParams({})) {
  if (!cal) return '';
  const bits = [];
  if (cal.closedMix != null) {
    const r = cal.closedMix / defaults.closedMix;
    bits.push(r > 1.25 ? 'lets heat in faster than average when closed' : r < 0.8 ? 'holds its temperature well when closed' : 'leaks heat at an average rate');
  }
  if (cal.sunScale != null) {
    bits.push(cal.sunScale > 1.3 ? 'gets a lot of sun heat' : cal.sunScale < 0.7 ? 'gets little sun heat' : 'gets a typical amount of sun');
  }
  if (cal.openMix != null) {
    const r = cal.openMix / defaults.openMix;
    bits.push(r > 1.2 ? 'airs out quickly' : r < 0.8 ? 'airs out slowly' : 'airs out at a normal pace');
  }
  return `Your room ${bits.join(', ')}.`;
}
