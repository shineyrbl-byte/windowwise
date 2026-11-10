// Shared helpers: JSON responses, CORS, body parsing, IDs, hashing, rate limits.

export function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJson(req, maxBytes = 16 * 1024) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Body too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomId(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fixed-window limit per client and action, stored in D1.
export async function rateLimit(env, req, action, max, windowSec) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${action}:${await sha256(ip)}:${bucket}`;
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  const count = row ? Number(row.v) : 0;
  if (count >= max) throw new HttpError(429, 'Too many requests, try again later');
  await env.DB.prepare('INSERT INTO kv (k, v, expires) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, String(count + 1), (bucket + 1) * windowSec * 1000)
    .run();
}

export async function cacheGet(env, key) {
  const row = await env.DB.prepare('SELECT v, expires FROM kv WHERE k = ?').bind(key).first();
  return row && row.expires > Date.now() ? JSON.parse(row.v) : null;
}
export async function cacheSet(env, key, value, ttlSec) {
  await env.DB.prepare('INSERT INTO kv (k, v, expires) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires = excluded.expires')
    .bind(key, JSON.stringify(value), Date.now() + ttlSec * 1000)
    .run();
}
