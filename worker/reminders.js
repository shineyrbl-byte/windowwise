// The scheduled job: every 10 minutes, plan each subscriber's next 24 hours
// and send a push or Telegram message when an open/close change is due.
import { fetchHours } from '../src/data.js';
import { makePlan } from '../src/engine.js';
import { upcomingChanges, toEpoch } from '../src/notify.js';
import { t, setLang } from '../src/i18n.js';
import { reasonText } from '../src/format.js';
import { sendPush } from './push.js';
import { sendMessage } from './telegram.js';

export const EARLY = 10 * 60e3; // fire up to 10 minutes before the change
const LATE = 5 * 60e3;
const MAX_PLACES = 15; // keep each run within the free plan's request limits

// The change that is due now (within the window), or null.
export function findDue(plan, utcOffset, now = Date.now()) {
  return (
    upcomingChanges(plan)
      .map((c) => ({ ...c, at: toEpoch(c.time, utcOffset) }))
      .find((c) => c.at - now <= EARLY && c.at - now > -LATE) || null
  );
}

async function messageFor(change, place, lang) {
  await setLang(lang);
  return { title: t(change.open ? 'n_open' : 'n_close'), body: `${place.name}: ${reasonText(change.hour)}.` };
}

export async function runReminders(env) {
  const push = env.VAPID_PRIVATE_JWK ? (await env.DB.prepare('SELECT * FROM push_subs LIMIT 500').all()).results : [];
  const chats = env.TELEGRAM_TOKEN ? (await env.DB.prepare('SELECT * FROM tg_subs LIMIT 500').all()).results : [];
  const subs = [...push.map((s) => ({ ...s, kind: 'push' })), ...chats.map((s) => ({ ...s, kind: 'tg' }))];
  if (!subs.length) return { sent: 0 };

  // One forecast per place, oldest-checked places first.
  const byPlace = new Map();
  for (const s of subs) {
    const place = JSON.parse(s.place);
    const k = `${place.lat},${place.lon}`;
    if (!byPlace.has(k)) byPlace.set(k, { place, subs: [] });
    byPlace.get(k).subs.push(s);
  }

  let sent = 0;
  const now = Date.now();
  for (const { place, subs: group } of [...byPlace.values()].slice(0, MAX_PLACES)) {
    let forecast;
    try {
      forecast = await fetchHours(place.lat, place.lon);
    } catch {
      continue;
    }
    for (const s of group) {
      const plan = makePlan(forecast.hours, JSON.parse(s.settings));
      const due = findDue(plan, forecast.utcOffset, now);
      if (!due) continue;
      const key = `${due.time}|${due.open}`;
      if (key === s.last_key) continue;
      const msg = await messageFor(due, place, s.lang);
      if (s.kind === 'push') {
        await env.DB.prepare('UPDATE push_subs SET message = ?, last_key = ? WHERE id = ?').bind(JSON.stringify(msg), key, s.id).run();
        const r = await sendPush(env, s.endpoint);
        if (r === 'gone') await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(s.id).run();
        if (r === 'ok') sent++;
      } else {
        const r = await sendMessage(env, s.chat_id, `${msg.title}\n${msg.body}`);
        if (r?.ok) {
          await env.DB.prepare('UPDATE tg_subs SET last_key = ? WHERE chat_id = ?').bind(key, s.chat_id).run();
          sent++;
        } else if (r?.error_code === 403) {
          // The user blocked the bot.
          await env.DB.prepare('DELETE FROM tg_subs WHERE chat_id = ?').bind(s.chat_id).run();
        }
      }
    }
  }
  // Housekeeping: expired cache/rate-limit rows and old link codes.
  await env.DB.prepare('DELETE FROM kv WHERE expires < ?').bind(now).run();
  await env.DB.prepare('DELETE FROM tg_links WHERE created < ?').bind(now - 24 * 3600e3).run();
  return { sent };
}
