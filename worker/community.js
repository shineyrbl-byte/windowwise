// Community readings: people who calibrated their room can share the result
// anonymously (no readings, location rounded to ~11 km). Others nearby get
// the median as a better starting point than the generic model.
import { json, readJson, rateLimit, HttpError } from './http.js';

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const SUNS = ['morning', 'afternoon', 'allday', 'shade', 'unsure'];
export const MIN_ROOMS = 3;
const RADIUS_DEG = 0.25; // about 25–28 km
const MAX_AGE = 180 * 24 * 3600e3;

export function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export async function shareRoom(req, env) {
  await rateLimit(env, req, 'community', 20, 3600);
  const b = await readJson(req);
  const device = typeof b.device === 'string' && /^[A-Za-z0-9]{16,40}$/.test(b.device) ? b.device : null;
  const lat = num(b.lat, -90, 90);
  const lon = num(b.lon, -180, 180);
  if (!device || lat == null || lon == null) throw new HttpError(400, 'Invalid request');
  const closedMix = num(b.closedMix, 0.02, 0.25);
  const sunScale = num(b.sunScale, 0, 2.2);
  const openMix = num(b.openMix, 0.15, 0.95);
  if (closedMix == null && openMix == null) throw new HttpError(400, 'Nothing to share');
  await env.DB.prepare(
    `INSERT INTO community (device, lat, lon, sun, closed_mix, sun_scale, open_mix, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, sun = excluded.sun, closed_mix = excluded.closed_mix,
       sun_scale = excluded.sun_scale, open_mix = excluded.open_mix, updated = excluded.updated`,
  )
    .bind(device, Math.round(lat * 10) / 10, Math.round(lon * 10) / 10, SUNS.includes(b.sun) ? b.sun : null, closedMix, sunScale, openMix, Date.now())
    .run();
  return json({ ok: true });
}

export async function unshareRoom(req, env) {
  const b = await readJson(req);
  if (typeof b.device !== 'string') throw new HttpError(400, 'Invalid request');
  await env.DB.prepare('DELETE FROM community WHERE device = ?').bind(b.device).run();
  return json({ ok: true });
}

export async function nearbyRooms(url, env) {
  const lat = num(Number(url.searchParams.get('lat')), -90, 90);
  const lon = num(Number(url.searchParams.get('lon')), -180, 180);
  if (lat == null || lon == null) throw new HttpError(400, 'Invalid place');
  const { results } = await env.DB.prepare(
    'SELECT closed_mix, sun_scale, open_mix FROM community WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND updated > ? LIMIT 500',
  )
    .bind(lat - RADIUS_DEG, lat + RADIUS_DEG, lon - RADIUS_DEG, lon + RADIUS_DEG, Date.now() - MAX_AGE)
    .all();
  if (results.length < MIN_ROOMS) return json({ n: results.length });
  const r2 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  return json(
    {
      n: results.length,
      closedMix: r2(median(results.map((r) => r.closed_mix))),
      sunScale: r2(median(results.map((r) => r.sun_scale))),
      openMix: r2(median(results.map((r) => r.open_mix))),
    },
    200,
    { 'Cache-Control': 'public, max-age=600' },
  );
}
