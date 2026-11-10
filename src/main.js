import './style.css';
import { searchPlaces, fetchHours } from './data.js';
import { DEFAULT_SETTINGS, FAN_FEELS_COOLER, pollenRisk, makePlan, toBlocks, summarize, daySummaries, hourOf, round } from './engine.js';
import { renderChart, renderLog } from './chart.js';
import { toQuery, fromQuery } from './share.js';
import { calibrate, describeKeys } from './calibrate.js';
import { createScheduler, notifySupport, showNotification } from './notify.js';
import { validWebhook, sendWebhook } from './webhook.js';
import * as api from './api.js';
import { t, setLang, getLang, LANGS } from './i18n.js';
import { clock, endClock, reasonText } from './format.js';

const $ = (id) => document.getElementById(id);
const STORE = 'windowwise:v1';
const CACHE_KEY = 'windowwise:forecast'; // last forecast, for offline use

const state = load() || { place: null, settings: { ...DEFAULT_SETTINGS }, sensitive: false };
// A live plan link (?plan=ID) follows a plan kept on the server.
const planParam = new URLSearchParams(location.search).get('plan');
if (planParam && /^[A-Za-z0-9]{6,12}$/.test(planParam)) {
  state.follow = planParam;
  history.replaceState(null, '', location.pathname);
}
// A shared hostel link sets the place and room settings for this device.
const shared = fromQuery(location.search);
if (shared) {
  state.place = shared.place;
  state.settings = { ...state.settings, ...shared.settings };
  state.sensitive = shared.sensitive;
  history.replaceState(null, '', location.pathname);
}

let lastHours = null;
let lastWeek = [];
let lastOffset = 0;
let lastSeries = [];
let calibration = null;
let community = null; // median calibrated room near this place, from other users
let livePlan = null; // the live plan being followed, as last fetched
let apiFeatures = {};
let station = null; // nearest ground air-quality station, if any
let lastPlan = null;
let refreshTimer = null;
let statusKey = null; // so status messages can be re-translated

const notifyChange = (change, name) => {
  // With server push on, the server sends reminders; don't double up.
  if (state.remind && notifySupport() === 'granted' && !state.push) {
    showNotification(change, name, { title: t(change.open ? 'n_open' : 'n_close'), body: `${reasonText(change.hour)}.` });
  }
  if (state.webhook && validWebhook(state.webhook)) {
    sendWebhook(state.webhook, {
      action: change.open ? 'open' : 'close',
      place: name,
      reason: change.reason,
      text: reasonText(change.hour),
      time: change.time,
    }).catch(() => {});
  }
};
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
// Nearby community rooms are a better default than the generic model,
// but your own calibration always wins.
function communityParams() {
  if (!community || community.n < 3) return null;
  const out = {};
  for (const k of ['closedMix', 'sunScale', 'openMix']) if (community[k] != null) out[k] = community[k];
  return out;
}

function settings() {
  const s = { ...baseSettings(), ...(calibration || communityParams() || {}) };
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
  sel.addEventListener('change', async () => {
    state.lang = await setLang(sel.value);
    sel.value = state.lang;
    save();
    syncPush();
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
  shareCalibration();
}

// Opt-in: send this room's calibration (no readings, ~11 km location).
function shareCalibration() {
  if (!state.shareRoom || !calibration || !state.place) return;
  const room = {
    device: api.deviceId(state),
    lat: state.place.lat,
    lon: state.place.lon,
    sun: state.settings.sun || 'unsure',
    closedMix: calibration.closedMix ?? null,
    sunScale: calibration.sunScale ?? null,
    openMix: calibration.openMix ?? null,
  };
  const sig = JSON.stringify(room);
  if (sig === state.sharedSig) return;
  api.shareRoom(room).then((r) => {
    if (r) {
      state.sharedSig = sig;
      save();
    }
  });
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
  if (!calibration && communityParams()) $('calib-status').textContent += ` ${t('community_using', { n: community.n })}`;
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

$('shareRoom').addEventListener('change', (e) => {
  state.shareRoom = e.target.checked;
  if (!state.shareRoom && state.device) {
    api.unshareRoom(state.device);
    state.sharedSig = null;
  }
  save();
  shareCalibration();
});

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

// Settings that a live plan shares (personal ones like electricity price stay local).
const PLAN_KEYS = ['sun', 'fan', 'pollenAllergy', 'crossVent', 'curtains', 'damp', 'comfortMax', 'comfortMin'];
const planSettings = () => Object.fromEntries(PLAN_KEYS.filter((k) => state.settings[k] != null).map((k) => [k, state.settings[k]]));
const isOwner = () => !!state.follow && state.owned?.id === state.follow;

let planTimer = null;
function schedulePlanUpdate() {
  if (!isOwner() || !state.place) return;
  clearTimeout(planTimer);
  planTimer = setTimeout(() => {
    api.updatePlan(state.owned.id, state.owned.key, {
      name: placeName(state.place),
      place: state.place,
      settings: planSettings(),
      sensitive: !!state.sensitive,
    });
  }, 1500);
}

// What the server needs to plan reminders for this device.
function serverSettings() {
  const s = settings();
  const out = {};
  for (const k of [...PLAN_KEYS, 'aqiLimit', 'closedMix', 'sunScale', 'openMix']) if (s[k] != null) out[k] = s[k];
  return out;
}

// ---------- server push ----------
const b64ToBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window;

async function currentPushSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function enablePush() {
  try {
    const key = await api.vapidKey();
    if (!key || !pushSupported() || !state.place) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
    const ok = await api.pushSubscribe({ subscription: sub.toJSON(), place: state.place, settings: serverSettings(), lang: getLang() });
    state.push = !!ok;
  } catch {
    state.push = false;
  }
  save();
  return state.push;
}

async function disablePush() {
  try {
    const sub = await currentPushSub();
    if (sub) {
      api.pushUnsubscribe(sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
  state.push = false;
  save();
}

// Keep the server's copy of place/settings/language up to date.
let pushTimer = null;
function syncPush() {
  if (!state.push) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const sub = await currentPushSub().catch(() => null);
    if (!sub) {
      state.push = false;
      save();
      return rerender();
    }
    api.pushSubscribe({ subscription: sub.toJSON(), place: state.place, settings: serverSettings(), lang: getLang() });
  }, 1500);
}

function settingsChanged() {
  schedulePlanUpdate();
  syncPush();
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
  $('shareRoom').checked = !!state.shareRoom;
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
  $('webhook').value = state.webhook || '';
  $('webhook').addEventListener('change', (e) => {
    const url = e.target.value.trim();
    if (url && !validWebhook(url)) return status('hook_invalid', {}, true);
    state.webhook = url || null;
    save();
    startRefresh();
    rerender();
    if (url) status('hook_saved');
  });
  $('hook-test').addEventListener('click', async () => {
    const url = $('webhook').value.trim();
    if (!validWebhook(url)) return status('hook_invalid', {}, true);
    try {
      await sendWebhook(url, { action: 'test', place: state.place ? placeName(state.place) : '', reason: 'test', text: 'WindowWise test', time: new Date().toISOString() });
      status('hook_sent');
    } catch {
      status('hook_failed', {}, true);
    }
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
  // Following someone else's live plan: their place and settings win.
  if (state.follow && !isOwner()) {
    const p = await api.getPlan(state.follow);
    if (p) {
      livePlan = p;
      place = p.place;
      for (const k of PLAN_KEYS) state.settings[k] = p.settings[k] ?? DEFAULT_SETTINGS[k];
      state.sensitive = !!p.sensitive;
      syncForm();
    } else if (!place) {
      return status('live_err', {}, true);
    }
  }
  if (!place) return status('start_hint');
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
    if (switched) station = null;
    loadStation(place);
    syncPush();
    updateCalibration();
    if (switched || !community) {
      community = null;
      api.nearbyRooms(place.lat, place.lon).then((r) => {
        community = r;
        updateCalibrationText();
        rerender();
      });
    }
    const noPollen = state.settings.pollenAllergy && !hours.some((h) => h.pollen);
    if (offline) status('offline', { time: new Date(savedAt).toLocaleString(LOCALES[getLang()] || [], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) });
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

// Live reading from the nearest ground station (OpenAQ, incl. CPCB).
function loadStation(place) {
  if (!apiFeatures.sensors || !place) return;
  api.sensors(place.lat, place.lon).then((r) => {
    if (state.place && placeKey(state.place) !== placeKey(place)) return;
    station = r?.station || null;
    rerender();
  });
}
const stationFresh = () => station && station.aqi != null && station.at && Date.now() - Date.parse(station.at) < 2 * 3600e3;

// ---------- rendering ----------
function render(hours) {
  // A fresh ground-station reading replaces the forecast for the current hour.
  if (stationFresh()) hours = [{ ...hours[0], aqi: station.aqi, pm25: station.pm25 }, ...hours.slice(1)];
  const s = settings();
  const plan = makePlan(hours, s);
  lastPlan = plan;
  const sum = summarize(plan, s);
  const days = lastWeek.length ? daySummaries(makePlan(lastWeek, s)).slice(0, 7) : [];
  const nextReminder =
    (state.remind && notifySupport() === 'granted') || validWebhook(state.webhook || '')
      ? scheduler.schedule(plan, lastOffset, placeName(state.place))
      : (scheduler.clear(), null);
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
  const printedAt = new Date().toLocaleString(LOCALES[getLang()] || [], { dateStyle: 'medium', timeStyle: 'short' });

  const ago = (ts) => {
    const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
    return m < 60 ? t('ago_min', { n: m }) : m < 48 * 60 ? t('ago_h', { n: Math.round(m / 60) }) : t('ago_d', { n: Math.round(m / 1440) });
  };
  const liveBanner = state.follow
    ? `<section class="card live no-print">
        <p>${
          isOwner()
            ? t('live_owner', { name: esc(placeName(place)) })
            : t('live_follow', { name: esc(livePlan?.name || placeName(place)), ago: livePlan ? ago(livePlan.updated) : '–' })
        }</p>
        <div class="row">
          <button type="button" class="ghost small-btn" data-act="live-copy">${t('live_copy')}</button>
          <button type="button" class="ghost small-btn" data-act="live-stop">${t('live_stop')}</button>
        </div>
      </section>`
    : '';
  const communityNote = !calibration && communityParams() ? ` <span class="small">${t('community_using', { n: community.n })}</span>` : '';

  $('out').innerHTML = `
    ${liveBanner}
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
        ${stationFresh() ? `<div><dt>${t('sensor_tile')}</dt><dd>PM2.5 ${station.pm25}</dd></div>` : ''}
      </dl>
      ${
        stationFresh()
          ? `<p class="small station">${t('sensor_line', {
              name: esc(`${station.name}${station.provider ? ` (${station.provider})` : ''}`),
              km: station.km,
              pm: station.pm25,
              aqi: station.aqi,
              ago: ago(Date.parse(station.at)),
            })} ${t('sensor_used')}</p>`
          : ''
      }
    </section>

    ${tonightCard}
    <section class="card benefit"><p>${benefit}${fanLine}${energyLine}${communityNote}</p></section>
    ${remindHtml(nextReminder, first)}
    <section class="card share no-print" aria-labelledby="share-h">
      <h3 id="share-h">${t('share_title')}</h3>
      <p>${t('share_text')}</p>
      <div class="row">
        <button type="button" data-act="share">${t('share')}</button>
        <button type="button" class="ghost" data-act="print">${t('print')}</button>
        <button type="button" class="ghost" data-act="embed">${t('embed_copy')}</button>
      </div>
      ${
        apiFeatures.plans && !state.follow
          ? `<p class="small live-help">${t('live_help')}</p><div class="row"><button type="button" class="ghost" data-act="live-create">${t('live_create')}</button></div>`
          : ''
      }
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
    body = `<p>${t(state.push ? 'push_on' : 'remind_on')} ${nextLine}</p>
      <div class="row"><button type="button" class="ghost" data-act="remind-test">${t('remind_test')}</button>
      <button type="button" class="ghost" data-act="remind-off">${t('remind_off')}</button></div>
      ${state.push ? '' : `<p class="small">${t('remind_note')}</p>`}`;
  } else {
    body = `<p>${t('remind_pitch')}</p>
      <div class="row"><button type="button" data-act="remind-on">${t('remind_turn_on')}</button></div>`;
  }
  const tg = apiFeatures.telegram
    ? `<div class="row tg"><button type="button" class="ghost" data-act="tg">${t('tg_button')}</button></div><p class="small">${t('tg_help')}</p>`
    : '';
  return `<section class="card remind" aria-labelledby="remind-h"><h3 id="remind-h">${t('remind_title')}</h3>${body}${tg}</section>`;
}

async function copyLiveLink() {
  const url = `${location.origin}${location.pathname}?plan=${state.follow}`;
  try {
    await navigator.clipboard.writeText(url);
    status('live_copied');
  } catch {
    status('copy_this', { url });
  }
}

function startRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = state.remind || state.webhook || state.follow ? setInterval(() => state.place && choose(state.place, true), 30 * 60 * 1000) : null;
}

$('out').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act || !lastHours) return;
  if (act === 'remind-on') {
    const perm = await Notification.requestPermission();
    state.remind = perm === 'granted';
    if (!state.remind) status('remind_refused', {}, true);
    else if (apiFeatures.push) await enablePush();
  } else if (act === 'remind-off') {
    state.remind = false;
    if (state.push) await disablePush();
  } else if (act === 'tg') {
    // Open the window during the click (popup blockers allow that), then point it at Telegram.
    const w = window.open('', '_blank');
    const r = await api.telegramLink({ place: state.place, settings: serverSettings(), lang: getLang() });
    if (!r) {
      w?.close();
      return status('tg_err', {}, true);
    }
    const url = `https://t.me/${encodeURIComponent(r.bot)}?start=${encodeURIComponent(r.code)}`;
    if (w) w.location.href = url;
    else location.href = url;
    return;
  } else if (act === 'speak') {
    const card = document.querySelector('.now');
    const text = ['.verdict', '.why', '.next'].map((sel) => card.querySelector(sel)?.textContent.trim()).join(' ');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALES[getLang()] || 'en-IN';
    speechSynthesis.speak(u);
    return;
  } else if (act === 'live-create') {
    const r = await api.createPlan({ name: placeName(state.place), place: state.place, settings: planSettings(), sensitive: !!state.sensitive });
    if (!r) return status('live_err', {}, true);
    state.owned = { id: r.id, key: r.editKey };
    state.follow = r.id;
    save();
    startRefresh();
    await copyLiveLink();
  } else if (act === 'live-copy') {
    await copyLiveLink();
    return;
  } else if (act === 'live-stop') {
    state.follow = null;
    livePlan = null;
    save();
    startRefresh();
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
  } else if (act === 'remind-test' && state.push) {
    const now = lastPlan[0];
    const sub = await currentPushSub().catch(() => null);
    if (sub) api.pushTest(sub.endpoint, t(now.open ? 'n_open' : 'n_close'), t('n_test', { why: reasonText(now) }));
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
async function start() {
  await setLang(state.lang || (navigator.language || '').slice(0, 2));
  initLanguage();
  initSettings();
  applyLanguage();
  startRefresh();
  api.features().then((f) => {
    apiFeatures = f;
    loadStation(state.place);
    rerender();
  });
  if (state.place || state.follow) {
    if (state.place) $('q').value = isMine(state.place) ? '' : state.place.name;
    choose(state.place);
  } else {
    status('start_hint');
  }
}
start();
