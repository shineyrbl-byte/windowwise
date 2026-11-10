// Text helpers shared by the main page and the embeddable widget.
import { hourOf, pollenRisk, round } from './engine.js';
import { t } from './i18n.js';

export const clock = (time) => `${String(hourOf(time)).padStart(2, '0')}:00`;
// The end of an hour block: a block ending at the 05:00 hour lasts until 06:00.
export const endClock = (time) => `${String((hourOf(time) + 1) % 24).padStart(2, '0')}:00`;

// The engine gives a reason code; the sentence is built here so it can be translated.
export function reasonText(h) {
  switch (h.reason) {
    case 'rain':
      return t('r_rain', { p: h.rainProb });
    case 'air':
      return t('r_air', { aqi: h.aqi });
    case 'pollen': {
      const risk = pollenRisk(h.pollen);
      return t('r_pollen', { name: t(`pollen_${risk.type}`), v: Math.round(risk.value) });
    }
    case 'cold':
      return t('r_cold', { t: round(h.temp) });
    case 'muggy':
      return t('r_muggy', { h: h.humidity });
    case 'cool':
      return t('r_cool', { t: round(h.temp) });
    case 'heat':
      return t('r_heat', { t: round(h.temp) });
    case 'fresh':
      return t('r_fresh');
    case 'wind':
      return t('r_wind', { g: Math.round(h.gust) });
    case 'damp':
      return t('r_damp', { h: h.humidity });
    case 'dry':
      return t('r_dry', { h: h.humidity });
    default:
      return h.text || '';
  }
}

