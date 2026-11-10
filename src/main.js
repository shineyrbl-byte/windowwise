import './style.css';
import { searchPlaces, fetchHours } from './data.js';
import { DEFAULT_SETTINGS, FAN_FEELS_COOLER, pollenRisk, makePlan, toBlocks, summarize, daySummaries, hourOf, round } from './engine.js';
import { renderChart, renderLog } from './chart.js';
import { toQuery, fromQuery } from './share.js';
import { calibrate, describeKeys } from './calibrate.js';
import { createScheduler, notifySupport, showNotification } from './notify.js';
import { t, setLang, getLang, LANGS } from './i18n.js';
import { clock, endClock, reasonText } from './format.js';

const $ = (id) => document.getElementById(id);
const STORE = 'windowwise:v1';
const CACHE_KEY = 'windowwise:forecast'; // last forecast, for offline use

const state = load() || { place: null, settings: { ...DEFAULT_SETTINGS }, sensitive: false };
// A shared hostel link sets the place and room settings for this device.
const shared = fromQuery(location.search);
if (shared) {
  state.place = shared.place;
  state.settings = { ...state.settings, ...shared.settings };
  state.sensitive = shared.sensitive;
  history.replaceState(null, '', location.pathname);
}
setLang(state.lang || (navigator.language || '').slice(0, 2));

let lastHours = null;
let lastWeek = [];
let lastOffset = 0;
let lastSeries = [];
let calibration = null;
let lastPlan = null;
let refreshTimer = null;
let statusKey = null; // so status messages can be re-translated

const notifyChange = (change, placeName) =>
  showNotification(change, placeName, { title: t(change.open ? 'n_open' : 'n_close'), body: `${reasonText(change.hour)}.` });
const scheduler = createScheduler({ show: notifyChange });

// Needed for notifications on Android and for installing as an app.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- storage (best effort: private windows may block it) ----------
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE));
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lowerFirst = (s) => (getLang() === 'en' ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', bn: 'bn-IN' };
const weekday = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(LOCALES[getLang()] || 'en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const dayLabel = (time, first) => (time.slice(0, 10) === first.slice(0, 10) ? '' : ` ${t('tomorrow')}`);
const when = (time, first) => `${clock(time)}${dayLabel(time, first)}`;
const strong = (s) => `<strong>${s}</strong>`;
const isMine = (p) => p.mine || p.name === 'Your location';
const placeName = (p) => (isMine(p) ? t('your_location') : p.name);

function status(key, vars = {}, isError = false) {
  statusKey = key ? { key, vars, isError } : null;
  $('status').textContent = key ? t(key, vars) : '';
  $('status').classList.toggle('error', isError);
}

function aqiBand(aqi) {
  if (aqi == null) return { label: t('aqi_na'), cls: 'na' };
  if (aqi <= 50) return { label: t('aqi_good'), cls: 'good' };
  if (aqi <= 100) return { label: t('aqi_moderate'), cls: 'ok' };
  if (aqi <= 150) return { label: t('aqi_sensitive'), cls: 'warn' };
  if (aqi <= 200) return { label: t('aqi_unhealthy'), cls: 'bad' };
  return { label: t('aqi_very'), cls: 'bad' };
}

function baseSettings() {
  return { ...state.settings, aqiLimit: state.sensitive ? 50 : 100 };
}

// Base settings plus anything learned from thermometer readings.
function settings() {
  const s = { ...baseSettings(), ...(calibration || {}) };
  const latest = placeReadings().at(-1);
  if (latest && Date.now() - latest.at < 3 * 3600 * 1000) s.startIndoor = latest.temp;
  return s;
}

const rerender = () => lastHours && render(lastHours);

// ---------- language ----------
function applyLanguage() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  $('footer-text').innerHTML = esc(t('footer')).replace('{link}', '<a href="https://open-meteo.com/">Open-Meteo</a>');
  if (statusKey) status(statusKey.key, statusKey.vars, statusKey.isError);
  updateCalibrationText();
  renderSaved();
  rerender();
}

function initLanguage() {
  const sel = $('lang');
  sel.innerHTML = Object.entries(LANGS)
    .map(([code, name]) => `<option value="${code}">${name}</option>`)
    .join('');
  sel.value = getLang();
  sel.addEventListener('change', () => {
    state.lang = setLang(sel.value);
    save();
    applyLanguage();
  });
}

// ---------- calibration ----------
function placeReadings() {
  const p = state.place;
  if (!p) return [];
  const week = Date.now() - 7 * 24 * 3600 * 1000;
  return (state.readings || [])
    .filter((r) => Math.abs(r.lat - p.lat) < 0.05 && Math.abs(r.lon - p.lon) < 0.05 && r.at > week)
    .sort((a, b) => a.at - b.at);
}

function updateCalibration() {
  calibration = lastSeries.length ? calibrate(placeReadings(), lastSeries, baseSettings()) : null;
  updateCalibrationText();
}

function updateCalibrationText() {
  const readings = placeReadings();
  const pairs = calibration ? (calibration.closedPairs || 0) + (calibration.openPairs || 0) : 0;
  const desc = calibration ? t('room_is', { parts: describeKeys(calibration).map((k) => t(k)).join(', ') }) : '';
  $('calib-log').innerHTML = readings.length
    ? renderLog(readings, lastSeries, t('log_aria')) +
      `<p class="legend"><span class="line plan"></span> ${t('log_room')} <span class="line out"></span> ${t('line_out')} · ● ${t('calib_closed')} ○ ${t('calib_open')}</p>`
    : '';
  $('calib-status').textContent = !readings.length
    ? t('calib_none')
    : calibration
      ? t('calib_done', { n: readings.length, p: pairs, desc })
      : t('calib_more', { n: readings.length });
}

$('calib-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.place) return status('calib_need_place', {}, true);
  const temp = Number($('calibTemp').value);
  state.readings = [
    ...(state.readings || []),
    { at: Date.now(), temp, open: $('calibOpen').value === 'open', lat: state.place.lat, lon: state.place.lon },
  ].slice(-40);
  save();
  $('calibTemp').value = '';
  updateCalibration();
  rerender();
});

// Bluetooth thermometers that use the standard Environmental Sensing service
// (0x181A) expose temperature as a signed 16-bit value in hundredths of a °C.
if (navigator.bluetooth) {
  $('bt-row').hidden = false;
  $('bt-read').addEventListener('click', async () => {
    let server;
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['environmental_sensing'] }] });
      server = await device.gatt.connect();
      const service = await server.getPrimaryService('environmental_sensing');
      const ch = await service.getCharacteristic('temperature');
      const value = await ch.readValue();
      const temp = Math.round(value.getInt16(0, true)) / 100;
      $('calibTemp').value = temp.toFixed(1);
      status('bt_ok', { t: temp.toFixed(1), name: device.name || 'Bluetooth' });
    } catch (err) {
      if (err?.name !== 'NotFoundError') status('bt_err', {}, true);
    } finally {
      server?.disconnect();
    }
  });
}

$('calib-reset').addEventListener('click', () => {
  const p = state.place;
  state.readings = (state.readings || []).filter((r) => !p || Math.abs(r.lat - p.lat) >= 0.05 || Math.abs(r.lon - p.lon) >= 0.05);
  save();
  updateCalibration();
  rerender();
});

// ---------- settings form ----------
const NUMBER_FIELDS = ['startIndoor', 'comfortMax', 'comfortMin', 'tariff', 'acKw'];
const CHECK_FIELDS = ['fan', 'pollenAllergy', 'crossVent', 'curtains', 'damp'];

// Saved places keep their own settings (a hostel room and a home room differ).
const placeKey = (p) => `${Number(p.lat).toFixed(2)},${Number(p.lon).toFixed(2)}`;
const isSaved = (p) => !!p && (state.saved || []).some((x) => placeKey(x) === placeKey(p));

function settingsChanged() {
  if (isSaved(state.place)) {
    state.placeSettings = { ...(state.placeSettings || {}), [placeKey(state.place)]: { ...state.settings, sensitive: state.sensitive } };
  }
  save();
  rerender();
}

function syncForm() {
  for (const key of NUMBER_FIELDS) $(key).value = state.settings[key] ?? (key === 'startIndoor' ? '' : DEFAULT_SETTINGS[key]);
  for (const key of CHECK_FIELDS) $(key).checked = !!state.settings[key];
  $('sun').value = state.settings.sun || 'unsure';
  $('currency').value = state.settings.currency ?? DEFAULT_SETTINGS.currency;
  $('sensitive').checked = !!state.sensitive;
}

const DISPLAY = ['simple', 'contrast', 'large'];
function applyDisplay() {
  const d = state.display || {};
  for (const key of DISPLAY) {
    document.documentElement.classList.toggle(`d-${key}`, !!d[key]);
    $(key).checked = !!d[key];
  }
}

function initSettings() {
  for (const key of DISPLAY) {
    $(key).addEventListener('change', (e) => {
      state.display = { ...(state.display || {}), [key]: e.target.checked };
      save();
      applyDisplay();
    });
  }
  applyDisplay();
  for (const key of NUMBER_FIELDS) {
    $(key).addEventListener('change', (e) => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      state.settings[key] = v ?? (key === 'startIndoor' ? null : DEFAULT_SETTINGS[key]);
      settingsChanged();
    });
  }
  for (const key of CHECK_FIELDS) {
    $(key).addEventListener('change', (e) => {
      state.settings[key] = e.target.checked;
      settingsChanged();
    });
  }
  $('sun').addEventListener('change', (e) => {
    state.settings.sun = e.target.value;
    settingsChanged();
  });
  $('currency').addEventListener('change', (e) => {
    state.settings.currency = e.target.value.trim().slice(0, 4) || DEFAULT_SETTINGS.currency;
    settingsChanged();
  });
  $('sensitive').addEventListener('change', (e) => {
    state.sensitive = e.target.checked;
    settingsChanged();
  });
  syncForm();
}

// ---------- saved places ----------
function renderSaved() {
  const saved = state.saved || [];
  const current = state.place;
  $('saved').innerHTML =
    saved
      .map(
        (p, i) => `<span class="chip ${current && placeKey(p) === placeKey(current) ? 'on' : ''}">
          <button type="button" data-saved="${i}">${esc(placeName(p))}</button>
          <button type="button" class="x" data-unsave="${i}" aria-label="${esc(t('unsave', { place: placeName(p) }))}">×</button>
        </span>`,
      )
      .join('') +
    (current && !isSaved(current) ? `<button type="button" class="ghost small-btn" data-act-save>☆ ${t('save_place')}</button>` : '');
  $('saved').hidden = !saved.length && !current;
}

$('saved').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-saved]');
  const drop = e.target.closest('[data-unsave]');
  if (e.target.closest('[data-act-save]') && state.place) {
    state.saved = [...(state.saved || []), state.place].slice(-8);
    settingsChanged();
  } else if (drop) {
    const p = state.saved[Number(drop.dataset.unsave)];
    state.saved = state.saved.filter((_, i) => i !== Number(drop.dataset.unsave));
    if (state.placeSettings) delete state.placeSettings[placeKey(p)];
    save();
  } else if (pick) {
    const p = state.saved[Number(pick.dataset.saved)];
    $('q').value = isMine(p) ? '' : p.name;
    choose(p);
    return;
  }
  renderSaved();
});

// ---------- place search ----------
$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('q').value;
  const list = $('results');
  try {
    status('searching');
    const places = await searchPlaces(q);
    if (places.length) status(null);
    else status('no_places', { q });
    list.innerHTML = places
      .map((p, i) => `<li><button type="button" data-i="${i}">${esc(p.name)} <span>${esc(p.region)}</span></button></li>`)
      .join('');
    list.hidden = !places.length;
    list.onclick = (ev) => {
      const btn = ev.target.closest('button[data-i]');
      if (!btn) return;
      list.hidden = true;
      choose(places[Number(btn.dataset.i)]);
    };
  } catch {
    status('search_err', {}, true);
  }
});

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return status('no_geo', {}, true);
  status('finding');
  navigator.geolocation.getCurrentPosition(
    (pos) => choose({ name: 'Your location', mine: true, region: '', lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) }),
    () => status('geo_blocked', {}, true),
    { timeout: 10000 },
  );
});

async function choose(place, quiet = false) {
  const switched = !state.place || placeKey(state.place) !== placeKey(place);
  state.place = place;
  const own = state.placeSettings?.[placeKey(place)];
  if (switched && own) {
    const { sensitive, ...rest } = own;
    state.settings = { ...DEFAULT_SETTINGS, ...rest };
    state.sensitive = !!sensitive;
    syncForm();
  }
  save();
  renderSaved();
  if (!quiet) status('loading', { place: placeName(place) });
  try {
    const { hours, week, hasAir, utcOffset, series, offline, savedAt } = await fetchWithOffline(place);
    lastHours = hours;
    lastWeek = week;
    lastOffset = utcOffset;
    lastSeries = series;
    updateCalibration();
    const noPollen = state.settings.pollenAllergy && !hours.some((h) => h.pollen);
    if (offline) status('offline', { time: new Date(savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) });
    else if (!hasAir) status('no_air');
    else if (noPollen) status('no_pollen');
    else status(null);
    render(hours);
  } catch {
    status('load_err', {}, true);
  }
}

// Save each forecast; when the network fails, rebuild today's hours from the
// saved week, starting at the current hour in the place's timezone.
async function fetchWithOffline(place) {
  try {
    const r = await fetchHours(place.lat, place.lon);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ key: placeKey(place), savedAt: Date.now(), r }));
    } catch {
      /* storage full or blocked */
    }
    return r;
  } catch (err) {
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    } catch {
      /* ignore */
    }
    if (!cached || cached.key !== placeKey(place) || Date.now() - cached.savedAt > 6 * 24 * 3600e3) throw err;
    const { r } = cached;
    const nowLocal = new Date(Date.now() + r.utcOffset * 1000).toISOString().slice(0, 13);
    const idx = r.week.findIndex((h) => h.time.slice(0, 13) === nowLocal);
    if (idx === -1) throw err;
    return { ...r, hours: r.week.slice(idx, idx + 24), week: r.week.slice(idx), offline: true, savedAt: cached.savedAt };
  }
}

// ---------- install ----------
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  $('install').hidden = true;
});
window.addEventListener('appinstalled', () => {
  $('install').hidden = true;
});

// ---------- rendering ----------
function render(hours) {
  const s = settings();
  const plan = makePlan(hours, s);
  lastPlan = plan;
  const sum = summarize(plan, s);
  const days = lastWeek.length ? daySummaries(makePlan(lastWeek, s)).slice(0, 7) : [];
  const nextReminder =
    state.remind && notifySupport() === 'granted' ? scheduler.schedule(plan, lastOffset, placeName(state.place)) : (scheduler.clear(), null);
  const blocks = toBlocks(plan);
  const first = plan[0].time;
  const now = sum.now;
  const band = aqiBand(now.aqi);
  const place = state.place;
  const name = esc(placeName(place));

  const nc = sum.nextChange;
  const next = nc
    ? t(nc.open ? 'next_open' : 'next_close', { when: strong(when(nc.time, first)), why: esc(lowerFirst(reasonText(nc))) })
    : t('no_change', { n: plan.length });

  const benefit =
    sum.saved >= 0.5
      ? t('benefit_saved', { plan: strong(`${sum.peakPlan}°C`), shut: strong(`${sum.peakShut}°C`), saved: strong(`${sum.saved}°C`) })
      : sum.openHours === 0
        ? t('benefit_none')
        : t('benefit_fresh', { plan: strong(`${sum.peakPlan}°C`) });

  const fanLine = state.settings.fan ? ` ${t('fan_line', { t: strong(`${round(sum.peakPlan - FAN_FEELS_COOLER)}°C`) })}` : '';
  const en = sum.energy;
  const energyLine =
    en.hours > 0
      ? ` ${t('energy_line', { h: strong(en.hours), kwh: en.kwh, money: strong(`${esc(en.currency)}${en.money}`), co2: en.co2 })}`
      : '';

  const tn = sum.tonight;
  const tonightCard = tn
    ? `<section class="card tonight" aria-labelledby="tonight-h">
        <h3 id="tonight-h">🌙 ${t('tonight_title')}</h3>
        <p>${
          tn.best
            ? t('tonight_open', { from: strong(clock(tn.best.start.time)), to: strong(endClock(tn.best.end.time)) })
            : t('tonight_closed', { why: esc(lowerFirst(reasonText(tn.closedBecause || tn.start))) })
        }</p>
      </section>`
    : '';

  const coldTip =
    sum.coldHours >= 6 && sum.openHours === 0 && sum.warmest
      ? `<div class="card tip cold-tip"><h3>❄️ ${t('cold_title')}</h3><p>${t('cold_tip', { when: strong(when(sum.warmest.time, first)), t: round(sum.warmest.temp) })}</p></div>`
      : '';

  const ct = sum.curtains;
  const curtainTip = ct
    ? `<div class="card tip"><h3>☀️ ${t('curtain_title')}</h3><p>${t('curtain_tip', { from: strong(clock(ct.from.time)), to: strong(endClock(ct.to.time)) })}</p></div>`
    : '';

  const weekHtml = days.length
    ? `<section class="card" aria-labelledby="week-h">
        <h3 id="week-h">${t('week_title')}</h3>
        <ul class="week">
          ${days
            .map((d, i) => {
              const b = aqiBand(d.maxAqi);
              const night = d.night?.best
                ? t('week_night', { from: clock(d.night.best.start.time), to: endClock(d.night.best.end.time) })
                : t('week_night_closed');
              return `<li>
                <span class="wd">${i === 0 ? t('today') : esc(weekday(d.date))}</span>
                <span class="temps">${Math.round(d.min)}–${Math.round(d.max)}°C</span>
                <span class="pill ${b.cls}">AQI ${d.maxAqi ?? '–'}</span>
                <span class="wopen">${d.rainHours ? '🌧️ ' : ''}${d.windHours ? '💨 ' : ''}${t('week_open', { n: d.openHours })}</span>
                <span class="wnight">🌙 ${night}</span>
              </li>`;
            })
            .join('')}
        </ul>
      </section>`
    : '';

  const ba = sum.bestAir;
  const airTip =
    sum.airHours >= 6 && ba
      ? `<div class="card tip warn-tip">
          <h3>${t('bad_air_title')}</h3>
          <p>${t('bad_air', {
            n: sum.airHours,
            total: plan.length,
            when: strong(when(ba.time, first)),
            level: ba.pm25 != null ? ` (PM2.5 ${Math.round(ba.pm25)} µg/m³)` : ` (AQI ${ba.aqi})`,
          })}</p>
        </div>`
      : '';

  const legendExtra = plan.some((h) => h.reason === 'pollen') ? ` <span class="key pollen"></span> ${t('closed_pollen')}` : '';
  const printedAt = new Date().toLocaleString(getLang() === 'hi' ? 'hi-IN' : [], { dateStyle: 'medium', timeStyle: 'short' });

  $('out').innerHTML = `
    <header class="print-only print-head">
      <h1>${t('print_title', { place: name })}</h1>
      <p>${t('print_sub', { from: clock(first), n: plan.length, at: esc(printedAt) })}</p>
    </header>
    <section class="card now ${now.open ? 'is-open' : 'is-closed'}" aria-labelledby="now-h">
      <p class="where">${name}${place.region ? `, ${esc(place.region)}` : ''} · ${clock(now.time)} ${t('local_time')}</p>
      <h2 id="now-h" class="verdict">
        <span class="icon" aria-hidden="true">${now.open ? windowOpenSvg : windowShutSvg}</span>
        ${t(now.open ? 'verdict_open' : 'verdict_closed')}
      </h2>
      <p class="why">${esc(reasonText(now))}.</p>
      <p class="next">${next}</p>
      ${'speechSynthesis' in window ? `<button type="button" class="ghost small-btn no-print" data-act="speak">🔊 ${t('read_aloud')}</button>` : ''}
      <dl class="facts">
        <div><dt>${t('outside')}</dt><dd>${round(now.temp)}°C</dd></div>
        <div><dt>${t('feels')}</dt><dd>${round(now.feels)}°C</dd></div>
        <div><dt>${t('humidity')}</dt><dd>${now.humidity}%</dd></div>
        <div><dt>${t('rain')}</dt><dd>${now.rainProb ?? '–'}%</dd></div>
        <div><dt>${t('air')}</dt><dd><span class="pill ${band.cls}">${now.aqi ?? '–'} · ${band.label}</span></dd></div>
        ${pollenTile(now)}
      </dl>
    </section>

    ${tonightCard}
    <section class="card benefit"><p>${benefit}${fanLine}${energyLine}</p></section>
    ${remindHtml(nextReminder, first)}
    <section class="card share no-print" aria-labelledby="share-h">
      <h3 id="share-h">${t('share_title')}</h3>
      <p>${t('share_text')}</p>
      <div class="row">
        <button type="button" data-act="share">${t('share')}</button>
        <button type="button" class="ghost" data-act="print">${t('print')}</button>
        <button type="button" class="ghost" data-act="embed">${t('embed_copy')}</button>
      </div>
    </section>
    ${airTip}
    ${coldTip}
    ${curtainTip}

    <section class="card" aria-labelledby="plan-h">
      <h3 id="plan-h">${t('next_hours', { n: plan.length })}</h3>
      <ol class="strip" aria-label="${t('hour_by_hour')}">
        ${plan
          .map((h) => {
            const label = `${clock(h.time)}: ${t(h.open ? 'open' : 'closed')}. ${esc(reasonText(h))}`;
            return `<li class="${h.open ? 'o' : 'c'} r-${h.reason}" title="${label}"><span class="sr-only">${label}.</span></li>`;
          })
          .join('')}
      </ol>
      <div class="strip-axis" aria-hidden="true">
        ${plan.map((h, i) => `<span>${i % 3 === 0 ? clock(h.time).slice(0, 2) : ''}</span>`).join('')}
      </div>
      <p class="legend"><span class="key o"></span> ${t('open')} <span class="key c"></span> ${t('closed')} <span class="key air"></span> ${t('closed_air')} <span class="key rain"></span> ${t('closed_rain')}${legendExtra}</p>

      <ul class="blocks">
        ${blocks
          .map(
            (b) => `<li class="${b.open ? 'o' : 'c'}">
              <span class="when">${clock(b.start)}–${clock(b.end).replace(/:00$/, ':59')}${dayLabel(b.start, first)}</span>
              <span class="what">${t(b.open ? 'open' : 'closed')}</span>
              <span class="reason">${esc(reasonText(b.first))}</span>
            </li>`,
          )
          .join('')}
      </ul>
    </section>

    <section class="card" aria-labelledby="chart-h">
      <h3 id="chart-h">${t('chart_title')}</h3>
      ${renderChart(plan, t('chart_aria', { n: plan.length }))}
      <p class="legend">
        <span class="line plan"></span> ${t('line_plan')}
        <span class="line shut"></span> ${t('line_shut')}
        <span class="line out"></span> ${t('line_out')}
      </p>
    </section>
    ${weekHtml}
  `;
}

function pollenTile(h) {
  const risk = pollenRisk(h.pollen);
  if (!risk) return '';
  const [key, cls] = risk.ratio >= 1 ? ['level_high', 'bad'] : risk.ratio >= 0.4 ? ['level_moderate', 'warn'] : ['level_low', 'good'];
  return `<div><dt>${t('pollen')}</dt><dd><span class="pill ${cls}">${t(key)} · ${t(`pollen_${risk.type}`)}</span></dd></div>`;
}

// ---------- reminders ----------
function remindHtml(next, first) {
  const support = notifySupport();
  let body;
  if (support === 'unsupported') {
    body = `<p>${t('remind_unsupported')}</p>`;
  } else if (support === 'denied') {
    body = `<p>${t('remind_denied')}</p>`;
  } else if (state.remind && support === 'granted') {
    const nextLine = next ? t(next.open ? 'remind_next_open' : 'remind_next_close', { when: strong(when(next.time, first)) }) : t('remind_none');
    body = `<p>${t('remind_on')} ${nextLine}</p>
      <div class="row"><button type="button" class="ghost" data-act="remind-test">${t('remind_test')}</button>
      <button type="button" class="ghost" data-act="remind-off">${t('remind_off')}</button></div>
      <p class="small">${t('remind_note')}</p>`;
  } else {
    body = `<p>${t('remind_pitch')}</p>
      <div class="row"><button type="button" data-act="remind-on">${t('remind_turn_on')}</button></div>`;
  }
  return `<section class="card remind" aria-labelledby="remind-h"><h3 id="remind-h">${t('remind_title')}</h3>${body}</section>`;
}

function startRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = state.remind ? setInterval(() => state.place && choose(state.place, true), 30 * 60 * 1000) : null;
}

$('out').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act || !lastHours) return;
  if (act === 'remind-on') {
    const perm = await Notification.requestPermission();
    state.remind = perm === 'granted';
    if (!state.remind) status('remind_refused', {}, true);
  } else if (act === 'remind-off') {
    state.remind = false;
  } else if (act === 'speak') {
    const card = document.querySelector('.now');
    const text = ['.verdict', '.why', '.next'].map((sel) => card.querySelector(sel)?.textContent.trim()).join(' ');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALES[getLang()] || 'en-IN';
    speechSynthesis.speak(u);
    return;
  } else if (act === 'embed') {
    const base = location.pathname.replace(/[^/]*$/, '');
    const src = `${location.origin}${base}embed.html?${toQuery(state.place, state.settings, state.sensitive)}&lang=${getLang()}`;
    const code = `<iframe src="${src}" width="360" height="230" style="border:0;border-radius:12px" title="WindowWise"></iframe>`;
    try {
      await navigator.clipboard.writeText(code);
      status('embed_copied');
    } catch {
      status('copy_this', { url: code });
    }
    return;
  } else if (act === 'print') {
    window.print();
    return;
  } else if (act === 'share') {
    const url = `${location.origin}${location.pathname}?${toQuery(state.place, state.settings, state.sensitive)}`;
    try {
      if (navigator.share) await navigator.share({ title: t('share_name', { place: placeName(state.place) }), url });
      else {
        await navigator.clipboard.writeText(url);
        status('copied');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') status('copy_this', { url });
    }
    return;
  } else if (act === 'remind-test') {
    const now = lastPlan[0];
    showNotification(now, placeName(state.place), {
      title: t(now.open ? 'n_open' : 'n_close'),
      body: t('n_test', { why: reasonText(now) }),
    });
    return;
  }
  save();
  startRefresh();
  rerender();
});

const windowOpenSvg = `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="6" y="5" width="36" height="38" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6 5 L20 11 V37 L6 43 Z M42 5 L28 11 V37 L42 43 Z" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
const windowShutSvg = `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="6" y="5" width="36" height="38" rx="3" fill="currentColor" fill-opacity=".15" stroke="currentColor" stroke-width="3"/><path d="M24 5v38M6 24h36" stroke="currentColor" stroke-width="3"/></svg>`;

// ---------- start ----------
initLanguage();
initSettings();
applyLanguage();
startRefresh();
if (state.place) {
  $('q').value = isMine(state.place) ? '' : state.place.name;
  choose(state.place);
} else {
  status('start_hint');
}
