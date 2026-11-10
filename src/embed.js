// Small card that other sites can embed with an <iframe>.
// Takes the same query as a shared link, plus an optional &lang=.
import './embed.css';
import { fetchHours } from './data.js';
import { makePlan, summarize, round } from './engine.js';
import { fromQuery } from './share.js';
import { t, setLang } from './i18n.js';
import { clock, endClock, reasonText } from './format.js';

const q = new URLSearchParams(location.search);
const box = document.getElementById('w');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function main() {
  await setLang(q.get('lang') || 'en');
  document.documentElement.lang = q.get('lang') || 'en';
  const shared = fromQuery(location.search);
  if (!shared) {
    box.innerHTML = `<p class="muted">${t('embed_missing')}</p>`;
    return;
  }
  const { place, settings, sensitive } = shared;
  const s = { ...settings, aqiLimit: sensitive ? 50 : 100 };
  try {
    const { hours } = await fetchHours(place.lat, place.lon);
    const plan = makePlan(hours, s);
    const sum = summarize(plan, s);
    const now = sum.now;
    const nc = sum.nextChange;
    const tn = sum.tonight;
    const full = `./?${location.search.slice(1).replace(/(^|&)lang=[^&]*/, '')}`;
    box.className = `w ${now.open ? 'is-open' : 'is-closed'}`;
    box.innerHTML = `
      <p class="where">${esc(place.name)} · ${clock(now.time)} · ${round(now.temp)}°C${now.aqi != null ? ` · AQI ${now.aqi}` : ''}</p>
      <p class="verdict">${t(now.open ? 'verdict_open' : 'verdict_closed')}</p>
      <p class="why">${esc(reasonText(now))}.</p>
      ${nc ? `<p class="next">${t(nc.open ? 'next_open' : 'next_close', { when: `<b>${clock(nc.time)}</b>`, why: esc(reasonText(nc)) })}</p>` : ''}
      ${tn ? `<p class="next">🌙 ${tn.best ? t('tonight_open', { from: `<b>${clock(tn.best.start.time)}</b>`, to: `<b>${endClock(tn.best.end.time)}</b>` }) : t('tonight_closed', { why: esc(reasonText(tn.closedBecause || tn.start)) })}</p>` : ''}
      <a href="${esc(full)}" target="_blank" rel="noopener">${t('embed_open')} ↗</a>`;
  } catch {
    box.innerHTML = `<p class="muted">${t('load_err')}</p>`;
  }
}
main();
// Refresh every 30 minutes so a noticeboard screen stays current.
setInterval(main, 30 * 60 * 1000);
