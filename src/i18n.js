// Interface text in English and Hindi. Use t('key', { name: value }).
// To add a language, copy src/locales/hi.js, translate it, and add it to LANGS and LOADERS.

export const LANGS = { en: 'English', hi: 'हिन्दी', mr: 'मराठी', bn: 'বাংলা', ta: 'தமிழ்', te: 'తెలుగు', kn: 'ಕನ್ನಡ' };

const en = {
  tagline: 'Know when to open your windows: cool your room for free, keep bad air out.',
  skip: 'Skip to content',
  language: 'Language',
  choose_place: 'Choose a place',
  city_label: 'City or town',
  search_ph: 'Search your city or town',
  search: 'Search',
  locate: 'Use my location',
  your_location: 'Your location',
  settings: 'Your room & preferences',
  start_indoor: 'Room temperature now (°C, optional)',
  estimate: 'Estimate',
  comfort_max: 'Keep the room under (°C)',
  comfort_min: 'Too cold below (°C)',
  sun_q: 'When does your window get direct sun?',
  sun_unsure: 'Not sure',
  sun_morning: 'Morning (faces east)',
  sun_afternoon: 'Afternoon (faces west)',
  sun_allday: 'Most of the day',
  sun_shade: 'Hardly ever (shaded)',
  fan: 'I have a fan running',
  sensitive: 'Asthma, allergies or sensitive lungs (stricter air limit, AQI 50)',
  pollen_allergy: 'Pollen allergy (keep the window shut when pollen is high; pollen data covers Europe only)',
  calib_title: 'Calibrate to your room (optional)',
  calib_help:
    'Have a thermometer? Log your room temperature a few times over a day or two, at least an hour apart. WindowWise compares your readings with the real outdoor weather for those hours and tunes its model to how your room behaves.',
  calib_temp: 'Room temperature now (°C)',
  calib_since: 'Since your last reading, the window was',
  calib_closed: 'Mostly closed',
  calib_open: 'Mostly open',
  calib_log: 'Log reading',
  reset: 'Reset',
  calib_none: 'No readings yet.',
  calib_done: 'Calibrated from {n} readings ({p} usable gaps). {desc}',
  calib_more: '{n} reading(s) logged. Calibration needs 3 readings, each 1–12 hours after the one before.',
  calib_need_place: 'Choose a place first, then log your reading.',
  room_is: 'Your room {parts}.',
  leak_fast: 'lets heat in faster than average when closed',
  leak_slow: 'holds its temperature well when closed',
  leak_avg: 'leaks heat at an average rate',
  sun_high: 'gets a lot of sun heat',
  sun_low: 'gets little sun heat',
  sun_avg: 'gets a typical amount of sun',
  air_fast: 'airs out quickly',
  air_slow: 'airs out slowly',
  air_avg: 'airs out at a normal pace',
  footer:
    'Weather and air quality from {link} (CC BY 4.0). The room temperature is a simple estimate, not a measurement. Use it as a guide, and follow local health advice on bad-air days.',

  start_hint: 'Search for your city, or use your location, to get today’s plan.',
  searching: 'Searching…',
  no_places: 'No places found for “{q}”.',
  search_err: 'Could not search right now. Check your connection and try again.',
  no_geo: 'Your browser does not share location. Search instead.',
  finding: 'Finding you…',
  geo_blocked: 'Location was blocked. Search for your city instead.',
  loading: 'Loading the forecast for {place}…',
  no_air: 'Air quality data is unavailable here, so the plan uses weather only.',
  no_pollen: "Pollen forecasts aren't available for this place (they cover Europe only), so the plan can't account for pollen.",
  load_err: 'The forecast is unavailable right now. Please try again in a moment.',

  local_time: 'local time',
  verdict_open: 'Open your window',
  verdict_closed: 'Keep your window closed',
  next_open: 'Open it at {when}: {why}.',
  next_close: 'Close it at {when}: {why}.',
  no_change: 'No change needed for the next {n} hours.',
  tomorrow: 'tomorrow',
  outside: 'Outside',
  feels: 'Feels like',
  humidity: 'Humidity',
  rain: 'Rain chance',
  air: 'Air quality',
  pollen: 'Pollen',
  benefit_saved:
    "Following this plan, your room should peak around {plan} instead of {shut} with the window shut. That's {saved} cooler, with no AC.",
  benefit_none: "Opening the window today wouldn't cool your room, so keeping it shut is the best option.",
  benefit_fresh: 'Your room stays around {plan} at its warmest. Opening the window adds fresh air without warming the room.',
  fan_line: 'With your fan on, it should feel more like {t} at its warmest.',
  bad_air_title: 'Bad-air day',
  bad_air:
    'The air outside is poor for {n} of the next {total} hours. Rooms still need some fresh air, so the least-polluted time to air out for 10–15 minutes is {when}{level}.',
  next_hours: 'Your next {n} hours',
  hour_by_hour: 'Hour by hour',
  open: 'Open',
  closed: 'Closed',
  closed_air: 'Closed: bad air',
  closed_rain: 'Closed: rain',
  closed_pollen: 'Closed: pollen',
  chart_title: 'Room temperature: plan vs. keeping it shut',
  chart_aria: 'Room temperature over the next {n} hours, with the plan and with the window shut.',
  line_plan: 'Room with plan',
  line_shut: 'Room, window shut',
  line_out: 'Outside',

  aqi_na: 'No data',
  aqi_good: 'Good',
  aqi_moderate: 'Moderate',
  aqi_sensitive: 'Unhealthy for sensitive groups',
  aqi_unhealthy: 'Unhealthy',
  aqi_very: 'Very unhealthy',
  level_high: 'High',
  level_moderate: 'Moderate',
  level_low: 'Low',

  r_rain: '{p}% chance of rain',
  r_air: 'Outdoor air is poor (AQI {aqi})',
  r_pollen: '{name} pollen is high ({v} grains/m³)',
  r_cold: 'Too cold outside ({t}°C)',
  r_muggy: 'Very humid outside ({h}%)',
  r_cool: 'Outside is cooler ({t}°C)',
  r_heat: 'Outside is hotter ({t}°C)',
  r_fresh: 'Mild outside: good time for fresh air',
  pollen_grass: 'Grass',
  pollen_birch: 'Birch',
  pollen_alder: 'Alder',
  pollen_mugwort: 'Mugwort',
  pollen_olive: 'Olive',
  pollen_ragweed: 'Ragweed',

  remind_title: 'Reminders',
  remind_unsupported: "Your browser doesn't support notifications. Try Chrome, Edge or Firefox, or install WindowWise to your home screen.",
  remind_denied: "Notifications are blocked for this site. Allow them in your browser's site settings to get reminders.",
  remind_on: '🔔 Reminders are on.',
  remind_next_open: 'Next reminder: open at {when}.',
  remind_next_close: 'Next reminder: close at {when}.',
  remind_none: 'No changes in the next 24 hours, so no reminders yet. The plan refreshes every 30 minutes.',
  remind_test: 'Send a test',
  remind_off: 'Turn off',
  remind_note: "Keep WindowWise open in a tab (it can be in the background) or install it as an app. Reminders can't arrive while it's fully closed.",
  remind_pitch: "Get a notification when it's time to open or close your window.",
  remind_turn_on: '🔔 Turn on reminders',
  remind_refused: 'Notifications were not allowed, so reminders stay off.',
  n_open: 'Open your window now',
  n_close: 'Time to close your window',
  n_test: 'Test reminder. Right now: {why}',

  share_title: 'Share with your hostel or flat',
  share_text:
    'Send everyone on your floor the same plan, or print a notice for the noticeboard. The link includes this place and your room settings, never your thermometer readings.',
  share: 'Share plan',
  print: 'Print notice',
  share_name: 'WindowWise plan for {place}',
  copied: 'Link copied. Paste it into your hostel group chat.',
  copy_this: 'Copy this link: {url}',
  print_title: 'Window plan: {place}',
  print_sub: 'From {from} for {n} hours · made {at} with WindowWise',
  cross_vent: 'My room has windows on two sides (cross-ventilation)',
  curtains: 'I close curtains or blinds when the sun is on the window',
  damp: 'Damp or monsoon mode (dry the room out when the air outside is drier)',
  energy_h: 'AC savings estimate',
  tariff: 'Electricity price per kWh',
  currency: 'Currency symbol',
  ac_kw: 'AC power use (kWh per hour)',
  tonight_title: 'Tonight',
  tonight_open: 'Sleep with the window open from {from} to {to}.',
  tonight_closed: 'Keep the window closed tonight: {why}.',
  cold_title: 'Cold day',
  cold_tip: "It's too cold outside to keep the window open. Air out for 5–10 minutes at {when} ({t}°C), the warmest time.",
  curtain_title: 'Curtains',
  curtain_tip: "Keep curtains or blinds closed from {from} to {to}, while the sun is on your window. It keeps out about half the sun's heat.",
  energy_line: "That's about {h} fewer hours of AC: {kwh} kWh, {money} and {co2} kg of CO₂ saved.",
  week_title: '7-day outlook',
  week_open: 'Open {n} h',
  week_night: 'Night {from}–{to}',
  week_night_closed: 'Night: closed',
  today: 'Today',
  r_wind: 'Strong wind gusts ({g} km/h)',
  r_damp: 'Humid outside ({h}%): opening would add moisture',
  r_dry: 'Drier air outside ({h}%): good for drying the room',
  save_place: 'Save this place',
  unsave: 'Remove {place}',
  log_aria: 'Your room readings and the outdoor temperature',
  log_room: 'Your room',
  install: '📲 Install app',
  display_h: 'Display',
  simple: 'Simple view: just the answer',
  contrast: 'High contrast',
  large: 'Larger text',
  read_aloud: 'Read aloud',
  embed_copy: 'Copy embed code',
  embed_copied: 'Embed code copied. Paste it into your hostel or college website.',
  embed_open: 'Open full plan',
  hook_h: 'Smart home (advanced)',
  hook_label: "Webhook URL to call when it's time to open or close",
  hook_help: 'For IFTTT, Home Assistant or similar: switch on a fan or a smart window opener. Called from this device while WindowWise is open or installed, with the action (open/close), place and reason. The URL is stored only on this device.',
  hook_test: 'Send a test',
  hook_invalid: 'The webhook must be an https:// address.',
  hook_saved: 'Webhook saved. It will be called at each open/close change.',
  hook_sent: 'Test sent. Check your smart-home app to see if it arrived.',
  hook_failed: "Couldn't send the test. Check the address and your connection.",
  embed_missing: 'This widget needs a place. Copy the embed code from WindowWise.',
  offline: "You're offline. Showing the forecast saved {time}.",
  bt_read: '📶 Read from a Bluetooth thermometer',
  bt_help: 'For thermometers that use the standard Bluetooth Environmental Sensing service, in Chrome or Edge (not iPhone).',
  bt_ok: 'Read {t}°C from {name}. Choose the window state and log it.',
  bt_err: "Couldn't read the thermometer. Check it is on, nearby, and supports Bluetooth Environmental Sensing.",
  live_create: "📡 Create a live plan",
  live_help: "A live plan stays in sync: when you change the settings, everyone with the link sees the update.",
  live_owner: "📡 You manage the live plan for {name}. Your setting changes are shared with everyone who follows it.",
  live_follow: "📡 Following the live plan for {name}, updated {ago}. Its settings replace yours while you follow it.",
  live_copy: "Copy live link",
  live_stop: "Stop",
  live_copied: "Live plan link copied. Share it with your floor.",
  live_err: "Couldn't reach the WindowWise server. Try again later.",
  community_share: "Share my room's calibration anonymously to help people nearby (location rounded to about 11 km, no readings)",
  community_using: "Using {n} calibrated rooms near you as a starting point.",
  ago_min: "{n} min ago",
  ago_h: "{n} h ago",
  ago_d: "{n} days ago",
  sensor_tile: "Ground station",
  sensor_line: "Nearest ground station: {name}, {km} km away. PM2.5 {pm} µg/m³ (AQI {aqi}), {ago}.",
  sensor_used: "Right now uses this live reading instead of the forecast.",
  push_on: "🔔 Reminders are on, even when WindowWise is closed.",
  tg_button: "💬 Get reminders on Telegram",
  tg_help: "Opens Telegram. Tap Start in the chat to connect this plan. Send /stop to the bot to stop.",
  tg_err: "Couldn't set up Telegram right now. Try again later.",
  tg_welcome: "Connected! I'll message you when it's time to open or close your window in {place}. Send /stop to stop.",
  tg_stopped: "Stopped. You won't get more messages.",
  tg_unknown: "Open WindowWise and tap \"Get reminders on Telegram\" to connect a plan.",
};



// Other languages load only when chosen, so the app stays small.
const LOADERS = {
  hi: () => import('./locales/hi.js'),
  mr: () => import('./locales/mr.js'),
  bn: () => import('./locales/bn.js'),
  ta: () => import('./locales/ta.js'),
  te: () => import('./locales/te.js'),
  kn: () => import('./locales/kn.js'),
};
const DICTS = { en };
let current = 'en';

export async function loadLang(lang) {
  if (!DICTS[lang] && LOADERS[lang]) {
    try {
      DICTS[lang] = (await LOADERS[lang]()).default;
    } catch {
      return false; // offline and not cached: stay on the current language
    }
  }
  return !!DICTS[lang];
}

export async function setLang(lang) {
  current = (await loadLang(lang)) ? lang : 'en';
  return current;
}
export const getLang = () => current;

export function t(key, vars = {}) {
  const str = DICTS[current]?.[key] ?? en[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
}

// Keys missing from a language, and keys whose {placeholders} don't match English.
export async function checkLang(lang) {
  await loadLang(lang);
  const d = DICTS[lang];
  const vars = (str) => (str.match(/\{\w+\}/g) || []).sort().join();
  return {
    missing: Object.keys(en).filter((k) => !(k in d)),
    badVars: Object.keys(en).filter((k) => k in d && vars(en[k]) !== vars(d[k])),
  };
}
