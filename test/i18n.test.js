import { describe, it, expect, afterEach } from 'vitest';
import { t, setLang, missingKeys, LANGS } from '../src/i18n.js';

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('has every key translated in every language', () => {
    for (const lang of Object.keys(LANGS)) expect(missingKeys(lang)).toEqual([]);
  });

  it('fills in values', () => {
    expect(t('r_rain', { p: 70 })).toBe('70% chance of rain');
    setLang('hi');
    expect(t('r_rain', { p: 70 })).toBe('बारिश की 70% संभावना');
  });

  it('falls back to English for unknown languages', () => {
    expect(setLang('xx')).toBe('en');
    expect(t('search')).toBe('Search');
  });
});
