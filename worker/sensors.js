// Nearest ground air-quality station via OpenAQ (which includes India's
// CPCB stations). The API key stays on the server.
import { json, cacheGet, cacheSet, HttpError } from './http.js';
import { pm25ToAqi } from '../src/engine.js';

const OPENAQ = 'https://api.openaq.org/v3';
const MAX_AGE = 3 * 3600e3; // ignore stations that haven't reported in 3 hours

async function openaq(env, path) {
  const res = await fetch(`${OPENAQ}${path}`, { headers: { 'X-API-Key': env.OPENAQ_KEY, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenAQ ${res.status}`);
  return res.json();
}

const km = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// Nearby locations that have PM2.5 sensors and reported recently, closest first.
// A location can have several PM2.5 sensors (old and new), so keep all their ids.
export function candidateStations(locations, here, now = Date.now()) {
  return locations
    .map((l) => {
      const sensorIds = (l.sensors || []).filter((s) => s.parameter?.name === 'pm25').map((s) => s.id);
      const last = Date.parse(l.datetimeLast?.utc || '');
      const pos = { lat: l.coordinates?.latitude, lon: l.coordinates?.longitude };
      return sensorIds.length && Number.isFinite(last) && now - last < MAX_AGE && pos.lat != null
        ? { id: l.id, sensorIds, name: l.name, provider: l.provider?.name || '', km: km(here, pos) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.km - b.km);
}

// The newest PM2.5 reading for a station, if it is recent enough.
export function freshReading(results, sensorIds, now = Date.now()) {
  return (
    results
      .filter((r) => sensorIds.includes(r.sensorsId) && Number.isFinite(r.value) && r.value >= 0)
      .map((r) => ({ ...r, t: Date.parse(r.datetime?.utc || '') }))
      .filter((r) => Number.isFinite(r.t) && now - r.t < MAX_AGE)
      .sort((a, b) => b.t - a.t)[0] || null
  );
}

export async function nearestStation(url, env) {
  if (!env.OPENAQ_KEY) throw new HttpError(501, 'Ground sensors are not configured');
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new HttpError(400, 'Invalid place');
  const key = `sensor:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = await cacheGet(env, key);
  if (cached) return json(cached);

  const locs = await openaq(env, `/locations?coordinates=${lat},${lon}&radius=25000&limit=20&parameters_id=2`);
  let out = { station: null };
  // Try up to three nearest stations until one has a fresh reading.
  for (const st of candidateStations(locs.results || [], { lat, lon }).slice(0, 3)) {
    const latest = await openaq(env, `/locations/${st.id}/latest`);
    const reading = freshReading(latest.results || [], st.sensorIds);
    if (!reading) continue;
    out = {
      station: {
        name: st.name,
        provider: st.provider,
        km: Math.round(st.km * 10) / 10,
        pm25: Math.round(reading.value * 10) / 10,
        aqi: pm25ToAqi(reading.value),
        at: reading.datetime.utc,
      },
    };
    break;
  }
  await cacheSet(env, key, out, 20 * 60);
  return json(out);
}
