// Telegram reminders. The app asks for a one-time link code, the user opens
// t.me/<bot>?start=<code>, and the bot's webhook connects that chat.
import { json, readJson, randomId, sha256, rateLimit, cacheGet, cacheSet, HttpError } from './http.js';
import { cleanPlace, cleanSettings, cleanLang } from './validate.js';
import { t, setLang } from '../src/i18n.js';

const tg = async (env, method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
};

export const sendMessage = (env, chatId, text) => tg(env, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });

// Secret Telegram must send back with each webhook call, derived from the token.
const webhookSecret = async (env) => (await sha256(`webhook:${env.TELEGRAM_TOKEN}`)).slice(0, 48);

// Registers the webhook once a day (cheap, and self-healing if it changes).
export async function ensureWebhook(env, origin) {
  if (await cacheGet(env, 'tg:webhook')) return;
  const r = await tg(env, 'setWebhook', { url: `${origin}/api/telegram/webhook`, secret_token: await webhookSecret(env), allowed_updates: ['message'] });
  if (r.ok) await cacheSet(env, 'tg:webhook', 1, 24 * 3600);
}

async function botName(env) {
  const cached = await cacheGet(env, 'tg:me');
  if (cached) return cached;
  const r = await tg(env, 'getMe');
  if (!r.ok) throw new HttpError(502, 'Telegram bot unavailable');
  await cacheSet(env, 'tg:me', r.result.username, 24 * 3600);
  return r.result.username;
}

export async function link(req, env, origin) {
  if (!env.TELEGRAM_TOKEN) throw new HttpError(501, 'Telegram is not configured');
  await rateLimit(env, req, 'tg-link', 20, 3600);
  const b = await readJson(req);
  const payload = { place: cleanPlace(b.place), settings: cleanSettings(b.settings), lang: cleanLang(b.lang) };
  const code = randomId(16);
  await env.DB.prepare('INSERT INTO tg_links (code, payload, created) VALUES (?, ?, ?)').bind(code, JSON.stringify(payload), Date.now()).run();
  await ensureWebhook(env, origin);
  return json({ code, bot: await botName(env) });
}

// "/start abc" -> { cmd: 'start', arg: 'abc' }
export function parseCommand(text = '') {
  const m = String(text).trim().match(/^\/(\w+)(?:@\w+)?(?:\s+(\S+))?/);
  return m ? { cmd: m[1].toLowerCase(), arg: m[2] || '' } : { cmd: '', arg: '' };
}

export async function webhook(req, env) {
  if (!env.TELEGRAM_TOKEN) throw new HttpError(501, 'Telegram is not configured');
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env))) throw new HttpError(403, 'Forbidden');
  const update = await readJson(req, 64 * 1024);
  const msg = update.message;
  if (!msg?.chat?.id) return json({ ok: true });
  const chatId = msg.chat.id;
  const { cmd, arg } = parseCommand(msg.text);

  if (cmd === 'start' && /^[A-Za-z0-9]{16}$/.test(arg)) {
    const row = await env.DB.prepare('SELECT payload, created FROM tg_links WHERE code = ?').bind(arg).first();
    if (row && Date.now() - row.created < 24 * 3600e3) {
      const p = JSON.parse(row.payload);
      await env.DB.prepare(
        `INSERT INTO tg_subs (chat_id, place, settings, lang, updated) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET place = excluded.place, settings = excluded.settings, lang = excluded.lang, last_key = NULL, updated = excluded.updated`,
      )
        .bind(chatId, JSON.stringify(p.place), JSON.stringify(p.settings), p.lang, Date.now())
        .run();
      await env.DB.prepare('DELETE FROM tg_links WHERE code = ?').bind(arg).run();
      await setLang(p.lang);
      await sendMessage(env, chatId, t('tg_welcome', { place: p.place.name }));
      return json({ ok: true });
    }
  }
  const sub = await env.DB.prepare('SELECT lang FROM tg_subs WHERE chat_id = ?').bind(chatId).first();
  await setLang(sub?.lang || 'en');
  if (cmd === 'stop') {
    await env.DB.prepare('DELETE FROM tg_subs WHERE chat_id = ?').bind(chatId).run();
    await sendMessage(env, chatId, t('tg_stopped'));
  } else {
    await sendMessage(env, chatId, t('tg_unknown'));
  }
  return json({ ok: true });
}
