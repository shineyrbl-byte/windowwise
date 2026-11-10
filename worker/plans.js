// Live hostel plans. Creating one returns an edit key (shown once, stored
// hashed). Anyone with the plan link follows it; only the key holder edits.
import { json, readJson, randomId, sha256, rateLimit, HttpError } from './http.js';
import { cleanPlace, cleanSettings, cleanName } from './validate.js';

const row2plan = (r) => ({
  id: r.id,
  name: r.name,
  place: JSON.parse(r.place),
  settings: JSON.parse(r.settings),
  sensitive: !!r.sensitive,
  updated: r.updated,
});

export async function createPlan(req, env) {
  await rateLimit(env, req, 'plan-create', 20, 3600);
  const body = await readJson(req);
  const id = randomId(8);
  const editKey = randomId(24);
  await env.DB.prepare('INSERT INTO plans (id, edit_hash, name, place, settings, sensitive, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, await sha256(editKey), cleanName(body.name), JSON.stringify(cleanPlace(body.place)), JSON.stringify(cleanSettings(body.settings)), body.sensitive ? 1 : 0, Date.now())
    .run();
  return json({ id, editKey }, 201);
}

export async function getPlan(id, env) {
  const r = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'Plan not found');
  return json(row2plan(r), 200, { 'Cache-Control': 'no-store' });
}

export async function updatePlan(id, req, env) {
  await rateLimit(env, req, 'plan-update', 120, 3600);
  const r = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'Plan not found');
  const key = req.headers.get('X-Edit-Key') || '';
  if (!key || (await sha256(key)) !== r.edit_hash) throw new HttpError(403, 'Wrong edit key');
  const body = await readJson(req);
  const next = {
    name: body.name != null ? cleanName(body.name) : r.name,
    place: body.place ? JSON.stringify(cleanPlace(body.place)) : r.place,
    settings: body.settings ? JSON.stringify(cleanSettings(body.settings)) : r.settings,
    sensitive: body.sensitive != null ? (body.sensitive ? 1 : 0) : r.sensitive,
  };
  await env.DB.prepare('UPDATE plans SET name = ?, place = ?, settings = ?, sensitive = ?, updated = ? WHERE id = ?')
    .bind(next.name, next.place, next.settings, next.sensitive, Date.now(), id)
    .run();
  return json({ ok: true });
}
