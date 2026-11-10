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

// Pick the closest location that has a PM2.5 sensor and reported recently.
export function pickStation(locations, here, now = Date.now()) {
  return locations
    .map((l) => {
      const sensor = (l.sensors || []).find((s) => s.parameter?.name === 'pm25');
      const last = Date.parse(l.datetimeLast?.utc || '');
      const pos = { lat: l.coordinates?.latitude, lon: l.coordinates?.longitude };
      return sensor && Number.isFinite(last) && now - last < MAX_AGE && pos.lat != null
        ? { id: l.id, sensorId: sensor.id, name: l.name, provider: l.provider?.name || '', km: km(here, pos) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.km - b.km)[0] || null;
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
  const station = pickStation(locs.results || [], { lat, lon });
  let out = { station: null };
  if (station) {
    const latest = await openaq(env, `/locations/${station.id}/latest`);
    const reading = (latest.results || []).find((r) => r.sensorsId === station.sensorId);
    if (reading && Number.isFinite(reading.value) && reading.value >= 0) {
      out = {
        station: {
          name: station.name,
          provider: station.provider,
          km: Math.round(station.km * 10) / 10,
          pm25: Math.round(reading.value * 10) / 10,
          aqi: pm25ToAqi(reading.value),
          at: reading.datetime?.utc || null,
        },
      };
    }
  }
  await cacheSet(env, key, out, 20 * 60);
  return json(out);
}
