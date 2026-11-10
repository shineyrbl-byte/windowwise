import { describe, it, expect } from 'vitest';
import { cleanPlace, cleanSettings, cleanLang, cleanName } from '../worker/validate.js';
import { median } from '../worker/community.js';
import { randomId, sha256 } from '../worker/http.js';

describe('worker validation', () => {
  it('rounds and limits a place', () => {
    expect(cleanPlace({ lat: 15.49123, lon: 73.82789, name: 'x'.repeat(200) })).toMatchObject({ lat: 15.49, lon: 73.83 });
    expect(cleanPlace({ lat: 1, lon: 2, name: 'x'.repeat(200) }).name).toHaveLength(80);
    expect(() => cleanPlace({ lat: 100, lon: 2 })).toThrow();
    expect(() => cleanPlace(null)).toThrow();
  });

  it('keeps only known, in-range settings', () => {
    expect(cleanSettings({ sun: 'afternoon', fan: true, damp: 'yes', comfortMax: 27, closedMix: 9, evil: '<script>' })).toEqual({
      sun: 'afternoon',
      fan: true,
      comfortMax: 27,
    });
  });

  it('cleans language and plan names', () => {
    expect(cleanLang('ta')).toBe('ta');
    expect(cleanLang('xx')).toBe('en');
    expect(cleanName('   ')).toBe('Hostel plan');
  });
});

describe('worker helpers', () => {
  it('takes medians and ignores missing values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, null, 1, 2, 3])).toBe(2.5);
    expect(median([null])).toBeNull();
  });

  it('makes random ids and stable hashes', async () => {
    expect(randomId(8)).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(randomId(8)).not.toBe(randomId(8));
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
