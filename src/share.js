// Hostel mode: put a place and room settings in a link so one person
// (a warden, a floor rep) can share the same plan with everyone.
// Thermometer readings and calibration are never included.

const r2 = (n) => Math.round(n * 100) / 100; // about 1 km, enough for weather

export function toQuery(place, settings, sensitive) {
  const q = new URLSearchParams();
  q.set('lat', r2(place.lat));
  q.set('lon', r2(place.lon));
  q.set('name', place.name);
  if (place.region) q.set('region', place.region);
  if (settings.sun && settings.sun !== 'unsure') q.set('sun', settings.sun);
  if (settings.fan) q.set('fan', '1');
  if (settings.pollenAllergy) q.set('pollen', '1');
  if (sensitive) q.set('sensitive', '1');
  if (settings.comfortMax != null) q.set('max', settings.comfortMax);
  if (settings.comfortMin != null) q.set('min', settings.comfortMin);
  return q.toString();
}

const SUNS = ['morning', 'afternoon', 'allday', 'shade', 'unsure'];
const num = (v, lo, hi) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

// Returns { place, settings, sensitive } or null if the link has no valid place.
export function fromQuery(search) {
  const q = new URLSearchParams(search);
  const lat = num(q.get('lat'), -90, 90);
  const lon = num(q.get('lon'), -180, 180);
  if (lat == null || lon == null) return null;
  const settings = {};
  if (SUNS.includes(q.get('sun'))) settings.sun = q.get('sun');
  if (q.get('fan') === '1') settings.fan = true;
  if (q.get('pollen') === '1') settings.pollenAllergy = true;
  const max = num(q.get('max'), 10, 45);
  const min = num(q.get('min'), 0, 35);
  if (max != null) settings.comfortMax = max;
  if (min != null) settings.comfortMin = min;
  return {
    place: {
      lat,
      lon,
      name: (q.get('name') || 'Shared place').slice(0, 80),
      region: (q.get('region') || '').slice(0, 120),
    },
    settings,
    sensitive: q.get('sensitive') === '1',
  };
}
