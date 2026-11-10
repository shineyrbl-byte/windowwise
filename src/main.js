import './style.css';
import { searchPlaces, fetchHours } from './data.js';
import { DEFAULT_SETTINGS, FAN_FEELS_COOLER, pollenRisk, makePlan, toBlocks, summarize, hourOf, round } from './engine.js';
import { renderChart } from './chart.js';
import { calibrate, describe as describeRoom } from './calibrate.js';
import { createScheduler, notifySupport, showNotification } from './notify.js';

const $ = (id) => document.getElementById(id);
const STORE = 'windowwise:v1';

const state = load() || { place: null, settings: { ...DEFAULT_SETTINGS }, sensitive: false };
let lastHours = null;
let lastOffset = 0;
let lastSeries = [];
let calibration = null;
let lastPlan = null;
let refreshTimer = null;
const scheduler = createScheduler({ show: showNotification });

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
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const clock = (time) => `${String(hourOf(time)).padStart(2, '0')}:00`;
const dayLabel = (time, first) => (time.slice(0, 10) === first.slice(0, 10) ? '' : ' tomorrow');
const status = (msg, isError = false) => {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
};

function aqiBand(aqi) {
  if (aqi == null) return { label: 'No data', cls: 'na' };
  if (aqi <= 50) return { label: 'Good', cls: 'good' };
  if (aqi <= 100) return { label: 'Moderate', cls: 'ok' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', cls: 'warn' };
  if (aqi <= 200) return { label: 'Unhealthy', cls: 'bad' };
  return { label: 'Very unhealthy', cls: 'bad' };
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
  const readings = placeReadings();
  calibration = lastSeries.length ? calibrate(readings, lastSeries, baseSettings()) : null;
  const pairs = calibration ? (calibration.closedPairs || 0) + (calibration.openPairs || 0) : 0;
  $('calib-status').textContent = !readings.length
    ? 'No readings yet.'
    : calibration
      ? `Calibrated from ${readings.length} readings (${pairs} usable ${pairs === 1 ? 'gap' : 'gaps'}). ${describeRoom(calibration)}`
      : `${readings.length} reading${readings.length === 1 ? '' : 's'} logged. Log another at least an hour after the last one to calibrate.`;
}

$('calib-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.place) return status('Choose a place first, then log your reading.', true);
  const temp = Number($('calibTemp').value);
  state.readings = [
    ...(state.readings || []),
    { at: Date.now(), temp, open: $('calibOpen').value === 'open', lat: state.place.lat, lon: state.place.lon },
  ].slice(-40);
  save();
  $('calibTemp').value = '';
  updateCalibration();
  if (lastHours) render(lastHours);
});

$('calib-reset').addEventListener('click', () => {
  const p = state.place;
  state.readings = (state.readings || []).filter((r) => !p || Math.abs(r.lat - p.lat) >= 0.05 || Math.abs(r.lon - p.lon) >= 0.05);
  save();
  updateCalibration();
  if (lastHours) render(lastHours);
});

// ---------- settings form ----------
function initSettings() {
  for (const key of ['startIndoor', 'comfortMax', 'comfortMin']) {
    const input = $(key);
    input.value = state.settings[key] ?? '';
    input.addEventListener('change', () => {
      const v = input.value === '' ? null : Number(input.value);
      state.settings[key] = v ?? (key === 'startIndoor' ? null : DEFAULT_SETTINGS[key]);
      save();
      if (lastHours) render(lastHours);
    });
  }
  $('sun').value = state.settings.sun || 'unsure';
  $('sun').addEventListener('change', (e) => {
    state.settings.sun = e.target.value;
    save();
    if (lastHours) render(lastHours);
  });
  $('fan').checked = !!state.settings.fan;
  $('fan').addEventListener('change', (e) => {
    state.settings.fan = e.target.checked;
    save();
    if (lastHours) render(lastHours);
  });
  $('pollenAllergy').checked = !!state.settings.pollenAllergy;
  $('pollenAllergy').addEventListener('change', (e) => {
    state.settings.pollenAllergy = e.target.checked;
    save();
    if (lastHours) render(lastHours);
  });
  $('sensitive').checked = state.sensitive;
  $('sensitive').addEventListener('change', (e) => {
    state.sensitive = e.target.checked;
    save();
    if (lastHours) render(lastHours);
  });
}

// ---------- place search ----------
$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('q').value;
  const list = $('results');
  try {
    status('Searching…');
    const places = await searchPlaces(q);
    status(places.length ? '' : `No places found for “${q}”.`);
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
    status('Could not search right now. Check your connection and try again.', true);
  }
});

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return status('Your browser does not share location. Search instead.', true);
  status('Finding you…');
  navigator.geolocation.getCurrentPosition(
    (pos) => choose({ name: 'Your location', region: '', lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) }),
    () => status('Location was blocked. Search for your city instead.', true),
    { timeout: 10000 },
  );
});

async function choose(place, quiet = false) {
  state.place = place;
  save();
  if (!quiet) status(`Loading the forecast for ${place.name}…`);
  try {
    const { hours, hasAir, utcOffset, series } = await fetchHours(place.lat, place.lon);
    lastHours = hours;
    lastOffset = utcOffset;
    lastSeries = series;
    updateCalibration();
    const noPollen = state.settings.pollenAllergy && !hours.some((h) => h.pollen);
    status(
      !hasAir
        ? 'Air quality data is unavailable here, so the plan uses weather only.'
        : noPollen
          ? "Pollen forecasts aren't available for this place (they cover Europe only), so the plan can't account for pollen."
          : '',
    );
    render(hours);
  } catch (err) {
    status(`${err.message}. Please try again in a moment.`, true);
  }
}

// ---------- rendering ----------
function render(hours) {
  const plan = makePlan(hours, settings());
  lastPlan = plan;
  const sum = summarize(plan);
  const nextReminder =
    state.remind && notifySupport() === 'granted' ? scheduler.schedule(plan, lastOffset, state.place.name) : (scheduler.clear(), null);
  const blocks = toBlocks(plan);
  const first = plan[0].time;
  const now = sum.now;
  const band = aqiBand(now.aqi);
  const place = state.place;

  const next = sum.nextChange
    ? `${sum.nextChange.open ? 'Open' : 'Close'} it at <strong>${clock(sum.nextChange.time)}${dayLabel(sum.nextChange.time, first)}</strong>: ${esc(lowerFirst(sum.nextChange.text))}.`
    : `No change needed for the next ${plan.length} hours.`;

  const benefit =
    sum.saved >= 0.5
      ? `Following this plan, your room should peak around <strong>${sum.peakPlan}°C</strong> instead of <strong>${sum.peakShut}°C</strong> with the window shut. That's <strong>${sum.saved}°C cooler</strong>, with no AC.`
      : sum.openHours === 0
        ? `Opening the window today wouldn't cool your room, so keeping it shut is the best option.`
        : `Your room stays around <strong>${sum.peakPlan}°C</strong> at its warmest. Opening the window adds fresh air without warming the room.`;

  const fanLine = state.settings.fan
    ? ` With your fan on, it should feel more like <strong>${round(sum.peakPlan - FAN_FEELS_COOLER)}°C</strong> at its warmest.`
    : '';

  const airTip =
    sum.airHours >= 6 && sum.bestAir
      ? `<div class="card tip warn-tip">
          <h3>Bad-air day</h3>
          <p>The air outside is poor for ${sum.airHours} of the next ${plan.length} hours. Rooms still need some fresh air, so the least-polluted time to air out for 10–15 minutes is
          <strong>${clock(sum.bestAir.time)}${dayLabel(sum.bestAir.time, first)}</strong>${sum.bestAir.pm25 != null ? ` (PM2.5 ${Math.round(sum.bestAir.pm25)} µg/m³)` : ` (AQI ${sum.bestAir.aqi})`}.</p>
        </div>`
      : '';

  $('out').innerHTML = `
    <section class="card now ${now.open ? 'is-open' : 'is-closed'}" aria-labelledby="now-h">
      <p class="where">${esc(place.name)}${place.region ? `, ${esc(place.region)}` : ''} · ${clock(now.time)} local time</p>
      <h2 id="now-h" class="verdict">
        <span class="icon" aria-hidden="true">${now.open ? windowOpenSvg : windowShutSvg}</span>
        ${now.open ? 'Open your window' : 'Keep your window closed'}
      </h2>
      <p class="why">${esc(now.text)}.</p>
      <p class="next">${next}</p>
      <dl class="facts">
        <div><dt>Outside</dt><dd>${round(now.temp)}°C</dd></div>
        <div><dt>Feels like</dt><dd>${round(now.feels)}°C</dd></div>
        <div><dt>Humidity</dt><dd>${now.humidity}%</dd></div>
        <div><dt>Rain chance</dt><dd>${now.rainProb ?? '–'}%</dd></div>
        <div><dt>Air quality</dt><dd><span class="pill ${band.cls}">${now.aqi ?? '–'} · ${band.label}</span></dd></div>
        ${pollenTile(now)}
      </dl>
    </section>

    <section class="card benefit"><p>${benefit}${fanLine}</p></section>
    ${remindHtml(nextReminder, first)}
    ${airTip}

    <section class="card" aria-labelledby="plan-h">
      <h3 id="plan-h">Your next ${plan.length} hours</h3>
      <ol class="strip" aria-label="Hour by hour">
        ${plan
          .map(
            (h) => `<li class="${h.open ? 'o' : 'c'} r-${h.reason}" title="${clock(h.time)}: ${h.open ? 'open' : 'closed'}. ${esc(h.text)}">
              <span class="sr-only">${clock(h.time)}: ${h.open ? 'open' : 'closed'}. ${esc(h.text)}.</span>
            </li>`,
          )
          .join('')}
      </ol>
      <div class="strip-axis" aria-hidden="true">
        ${plan.map((h, i) => `<span>${i % 3 === 0 ? clock(h.time).slice(0, 2) : ''}</span>`).join('')}
      </div>
      <p class="legend"><span class="key o"></span> Open <span class="key c"></span> Closed <span class="key air"></span> Closed: bad air <span class="key rain"></span> Closed: rain${plan.some((h) => h.reason === 'pollen') ? ' <span class="key pollen"></span> Closed: pollen' : ''}</p>

      <ul class="blocks">
        ${blocks
          .map(
            (b) => `<li class="${b.open ? 'o' : 'c'}">
              <span class="when">${clock(b.start)}–${clock(b.end).replace(/:00$/, ':59')}${dayLabel(b.start, first)}</span>
              <span class="what">${b.open ? 'Open' : 'Closed'}</span>
              <span class="reason">${esc(b.text)}</span>
            </li>`,
          )
          .join('')}
      </ul>
    </section>

    <section class="card" aria-labelledby="chart-h">
      <h3 id="chart-h">Room temperature: plan vs. keeping it shut</h3>
      ${renderChart(plan)}
      <p class="legend">
        <span class="line plan"></span> Room with plan
        <span class="line shut"></span> Room, window shut
        <span class="line out"></span> Outside
      </p>
    </section>
  `;
}

function pollenTile(h) {
  const risk = pollenRisk(h.pollen);
  if (!risk) return '';
  const level = risk.ratio >= 1 ? ['High', 'bad'] : risk.ratio >= 0.4 ? ['Moderate', 'warn'] : ['Low', 'good'];
  return `<div><dt>Pollen</dt><dd><span class="pill ${level[1]}">${level[0]} · ${esc(risk.name)}</span></dd></div>`;
}

// ---------- reminders ----------
function remindHtml(next, first) {
  const support = notifySupport();
  let body;
  if (support === 'unsupported') {
    body = `<p>Your browser doesn't support notifications. Try Chrome, Edge or Firefox, or install WindowWise to your home screen.</p>`;
  } else if (support === 'denied') {
    body = `<p>Notifications are blocked for this site. Allow them in your browser's site settings to get reminders.</p>`;
  } else if (state.remind && support === 'granted') {
    const when = next
      ? `Next reminder: <strong>${next.open ? 'open' : 'close'} at ${clock(next.time)}${dayLabel(next.time, first)}</strong>.`
      : 'No changes in the next 24 hours, so no reminders yet. The plan refreshes every 30 minutes.';
    body = `<p>🔔 Reminders are on. ${when}</p>
      <div class="row"><button type="button" class="ghost" data-act="remind-test">Send a test</button>
      <button type="button" class="ghost" data-act="remind-off">Turn off</button></div>
      <p class="small">Keep WindowWise open in a tab (it can be in the background) or install it as an app. Reminders can't arrive while it's fully closed.</p>`;
  } else {
    body = `<p>Get a notification when it's time to open or close your window.</p>
      <div class="row"><button type="button" data-act="remind-on">🔔 Turn on reminders</button></div>`;
  }
  return `<section class="card remind" aria-labelledby="remind-h"><h3 id="remind-h">Reminders</h3>${body}</section>`;
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
    if (!state.remind) status('Notifications were not allowed, so reminders stay off.', true);
  } else if (act === 'remind-off') {
    state.remind = false;
  } else if (act === 'remind-test') {
    const now = lastPlan[0];
    showNotification({ open: now.open, text: `Test reminder. Right now: ${now.text}` }, state.place.name);
    return;
  }
  save();
  startRefresh();
  render(lastHours);
});

const windowOpenSvg = `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="6" y="5" width="36" height="38" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6 5 L20 11 V37 L6 43 Z M42 5 L28 11 V37 L42 43 Z" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
const windowShutSvg = `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="6" y="5" width="36" height="38" rx="3" fill="currentColor" fill-opacity=".15" stroke="currentColor" stroke-width="3"/><path d="M24 5v38M6 24h36" stroke="currentColor" stroke-width="3"/></svg>`;

// ---------- start ----------
initSettings();
startRefresh();
if (state.place) {
  $('q').value = state.place.name === 'Your location' ? '' : state.place.name;
  choose(state.place);
} else {
  status('Search for your city, or use your location, to get today’s plan.');
}
