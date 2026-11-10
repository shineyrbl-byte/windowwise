import { describe, it, expect } from 'vitest';
import { toQuery, fromQuery } from '../src/share.js';

describe('share links', () => {
  it('round-trips a place and settings', () => {
    const q = toQuery({ name: 'Panaji', region: 'Goa, India', lat: 15.49123, lon: 73.82789 }, { sun: 'afternoon', fan: true, comfortMax: 27, comfortMin: 19 }, true);
    expect(fromQuery(`?${q}`)).toEqual({
      place: { name: 'Panaji', region: 'Goa, India', lat: 15.49, lon: 73.83 },
      settings: { sun: 'afternoon', fan: true, comfortMax: 27, comfortMin: 19 },
      sensitive: true,
    });
  });

  it('ignores links without a valid place', () => {
    expect(fromQuery('?name=x')).toBeNull();
    expect(fromQuery('?lat=200&lon=10')).toBeNull();
  });

  it('drops unknown or out-of-range settings', () => {
    const r = fromQuery('?lat=10&lon=20&sun=moon&max=99&fan=yes');
    expect(r.settings).toEqual({});
    expect(r.place.name).toBe('Shared place');
  });
});
