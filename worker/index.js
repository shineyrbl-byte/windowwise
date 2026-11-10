// WindowWise API entry point: routes requests and runs the scheduled job.
import { corsHeaders, json, HttpError } from './http.js';
import { createPlan, getPlan, updatePlan } from './plans.js';
import { shareRoom, unshareRoom, nearbyRooms } from './community.js';
import * as push from './push.js';
import * as telegram from './telegram.js';
import { nearestStation } from './sensors.js';
import { runReminders } from './reminders.js';

async function route(req, env, url) {
  const p = url.pathname;
  const m = req.method;
  if (p === '/api/health') return json({ ok: true, features: features(env), vapidPublic: env.VAPID_PUBLIC || null });
  if (p === '/api/plans' && m === 'POST') return createPlan(req, env);
  const plan = p.match(/^\/api\/plans\/([A-Za-z0-9]{6,12})$/);
  if (plan && m === 'GET') return getPlan(plan[1], env);
  if (plan && m === 'PUT') return updatePlan(plan[1], req, env);
  if (p === '/api/community' && m === 'GET') return nearbyRooms(url, env);
  if (p === '/api/community' && m === 'POST') return shareRoom(req, env);
  if (p === '/api/community' && m === 'DELETE') return unshareRoom(req, env);
  if (p === '/api/sensors' && m === 'GET') return nearestStation(url, env);
  if (p.startsWith('/api/push') && !features(env).push) throw new HttpError(501, 'Push is not configured');
  if (p === '/api/push' && m === 'POST') return push.subscribe(req, env);
  if (p === '/api/push' && m === 'DELETE') return push.unsubscribe(req, env);
  if (p === '/api/push/message' && m === 'POST') return push.message(req, env);
  if (p === '/api/push/test' && m === 'POST') return push.test(req, env);
  if (p === '/api/telegram/link' && m === 'POST') return telegram.link(req, env, url.origin);
  if (p === '/api/telegram/webhook' && m === 'POST') return telegram.webhook(req, env);
  throw new HttpError(404, 'Not found');
}

// Which optional features have their secrets configured.
export const features = (env) => ({
  plans: true,
  community: true,
  sensors: !!env.OPENAQ_KEY,
  push: !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE_JWK),
  telegram: !!env.TELEGRAM_TOKEN,
});

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    let res;
    try {
      res = await route(req, env, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      res = json({ error: status === 500 ? 'Server error' : err.message }, status);
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).catch((err) => console.error('reminders failed', err)));
  },
};
