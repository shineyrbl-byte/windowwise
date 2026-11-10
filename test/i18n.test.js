import { describe, it, expect, afterEach } from 'vitest';
import { t, setLang, checkLang, LANGS } from '../src/i18n.js';

describe('i18n', () => {
  afterEach(() => setLang('en'));

  for (const lang of Object.keys(LANGS).filter((l) => l !== 'en')) {
    it(`${lang} has every key, with the same placeholders as English`, async () => {
      expect(await checkLang(lang)).toEqual({ missing: [], badVars: [] });
    });
  }

  it('fills in values', async () => {
    expect(t('r_rain', { p: 70 })).toBe('70% chance of rain');
    await setLang('hi');
    expect(t('r_rain', { p: 70 })).toBe('बारिश की 70% संभावना');
  });

  it('falls back to English for unknown languages', async () => {
    expect(await setLang('xx')).toBe('en');
    expect(t('search')).toBe('Search');
  });
});
