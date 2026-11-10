// Checks everything the browser sends before it is stored or used.
import { HttpError } from './http.js';

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const SUNS = ['morning', 'afternoon', 'allday', 'shade', 'unsure'];
const LANGS = ['en', 'hi', 'mr', 'bn', 'ta', 'te', 'kn'];

export function cleanPlace(p) {
  if (!p || typeof p !== 'object') throw new HttpError(400, 'Missing place');
  const lat = num(p.lat, -90, 90);
  const lon = num(p.lon, -180, 180);
  if (lat == null || lon == null) throw new HttpError(400, 'Invalid place');
  return {
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
    name: String(p.name || 'Shared place').slice(0, 80),
    region: String(p.region || '').slice(0, 120),
  };
}

// Only the settings that change the plan, each range-checked.
export function cleanSettings(s = {}) {
  const out = {};
  if (SUNS.includes(s.sun)) out.sun = s.sun;
  for (const k of ['fan', 'pollenAllergy', 'crossVent', 'curtains', 'damp']) if (s[k] === true) out[k] = true;
  const ranges = { comfortMax: [10, 45], comfortMin: [0, 35], aqiLimit: [10, 300], closedMix: [0.02, 0.25], sunScale: [0, 2.2], openMix: [0.15, 0.95] };
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    const v = num(s[k], lo, hi);
    if (v != null) out[k] = v;
  }
  return out;
}

export const cleanLang = (l) => (LANGS.includes(l) ? l : 'en');
export const cleanName = (n) => String(n || '').trim().slice(0, 60) || 'Hostel plan';
