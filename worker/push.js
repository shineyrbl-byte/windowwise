// Web push without payload encryption: the push is an empty "wake up"
// signal signed with VAPID, and the service worker then fetches the
// message from /api/push/message. This keeps the server simple and the
// message text off the push service.
import { json, readJson, sha256, rateLimit, HttpError } from './http.js';
import { cleanPlace, cleanSettings, cleanLang } from './validate.js';

const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];

export function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

// ES256-signed JWT for the push service at `audience`.
export async function vapidJwt(privateJwk, audience, subject, now = Date.now()) {
  const header = b64urlText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64urlText(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

const SUBJECT = 'https://github.com/shineyrbl-byte/windowwise';

// Returns 'ok', 'gone' (subscription expired: delete it) or 'error'.
export async function sendPush(env, endpoint) {
  const jwt = await vapidJwt(JSON.parse(env.VAPID_PRIVATE_JWK), new URL(endpoint).origin, SUBJECT);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, TTL: '3600', Urgency: 'high', 'Content-Length': '0' },
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'ok' : 'error';
}

const subId = async (endpoint) => (await sha256(endpoint)).slice(0, 32);

export async function subscribe(req, env) {
  await rateLimit(env, req, 'push-sub', 60, 3600);
  const b = await readJson(req);
  const endpoint = b.subscription?.endpoint;
  if (!allowedEndpoint(endpoint)) throw new HttpError(400, 'Unsupported push service');
  const id = await subId(endpoint);
  await env.DB.prepare(
    `INSERT INTO push_subs (id, endpoint, place, settings, lang, updated) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET place = excluded.place, settings = excluded.settings, lang = excluded.lang, updated = excluded.updated`,
  )
    .bind(id, endpoint, JSON.stringify(cleanPlace(b.place)), JSON.stringify(cleanSettings(b.settings)), cleanLang(b.lang), Date.now())
    .run();
  return json({ ok: true });
}

export async function unsubscribe(req, env) {
  const b = await readJson(req);
  if (typeof b.endpoint !== 'string') throw new HttpError(400, 'Invalid request');
  await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(await subId(b.endpoint)).run();
  return json({ ok: true });
}

// Called by the service worker after a push arrives.
export async function message(req, env) {
  const b = await readJson(req);
  if (typeof b.endpoint !== 'string') throw new HttpError(400, 'Invalid request');
  const row = await env.DB.prepare('SELECT message FROM push_subs WHERE id = ?').bind(await subId(b.endpoint)).first();
  return json(row?.message ? JSON.parse(row.message) : { title: 'WindowWise', body: 'Time to check your window.' }, 200, { 'Cache-Control': 'no-store' });
}

// "Send a test" button: stores a test message and pushes it.
export async function test(req, env) {
  await rateLimit(env, req, 'push-test', 10, 3600);
  const b = await readJson(req);
  if (!allowedEndpoint(b.endpoint)) throw new HttpError(400, 'Unsupported push service');
  const id = await subId(b.endpoint);
  const row = await env.DB.prepare('SELECT id FROM push_subs WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Not subscribed');
  const msg = { title: String(b.title || 'WindowWise').slice(0, 80), body: String(b.body || '').slice(0, 200) };
  await env.DB.prepare('UPDATE push_subs SET message = ? WHERE id = ?').bind(JSON.stringify(msg), id).run();
  const r = await sendPush(env, b.endpoint);
  if (r === 'gone') await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(id).run();
  return json({ result: r });
}
