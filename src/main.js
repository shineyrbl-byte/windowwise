import './style.css';
import { searchPlaces, fetchHours } from './data.js';
import { DEFAULT_SETTINGS, makePlan, toBlocks, summarize, hourOf, round } from './engine.js';
import { renderChart } from './chart.js';

const $ = (id) => document.getElementById(id);
const STORE = 'windowwise:v1';

const state = load() || { place: null, settings: { ...DEFAULT_SETTINGS }, sensitive: false };
let lastHours = null;

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

function settings() {
  return { ...state.settings, aqiLimit: state.sensitive ? 50 : 100 };
}

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

async function choose(place) {
  state.place = place;
  save();
  status(`Loading the forecast for ${place.name}…`);
  try {
    const { hours, hasAir } = await fetchHours(place.lat, place.lon);
    lastHours = hours;
    status(hasAir ? '' : 'Air quality data is unavailable here, so the plan uses weather only.');
    render(hours);
  } catch (err) {
    status(`${err.message}. Please try again in a moment.`, true);
  }
}

// ---------- rendering ----------
function render(hours) {
  const plan = makePlan(hours, settings());
  const sum = summarize(plan);
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
      </dl>
    </section>

    <section class="card benefit"><p>${benefit}</p></section>
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
      <p class="legend"><span class="key o"></span> Open <span class="key c"></span> Closed <span class="key air"></span> Closed: bad air <span class="key rain"></span> Closed: rain</p>

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

const windowOpenSvg = `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="6" y="5" width="36" height="38" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6 5 L20 11 V37 L6 43 Z M42 5 L28 11 V37 L42 43 Z" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
const windowShutSvg = `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="6" y="5" width="36" height="38" rx="3" fill="currentColor" fill-opacity=".15" stroke="currentColor" stroke-width="3"/><path d="M24 5v38M6 24h36" stroke="currentColor" stroke-width="3"/></svg>`;

// ---------- start ----------
initSettings();
if (state.place) {
  $('q').value = state.place.name === 'Your location' ? '' : state.place.name;
  choose(state.place);
} else {
  status('Search for your city, or use your location, to get today’s plan.');
}
