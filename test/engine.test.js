import { describe, it, expect } from 'vitest';
import { decideHour, makePlan, toBlocks, summarize } from '../src/engine.js';

const hour = (over) => ({
  time: '2026-11-09T02:00',
  temp: 24,
  humidity: 60,
  rainProb: 0,
  aqi: 40,
  ...over,
});

describe('decideHour', () => {
  it('opens when outside is cooler than the room', () => {
    expect(decideHour(hour({ temp: 22 }), 28)).toMatchObject({ open: true, reason: 'cool' });
  });

  it('closes when outside is hotter', () => {
    expect(decideHour(hour({ temp: 35 }), 28)).toMatchObject({ open: false, reason: 'heat' });
  });

  it('closes for rain even if cooler', () => {
    expect(decideHour(hour({ temp: 22, rainProb: 80 }), 28)).toMatchObject({ open: false, reason: 'rain' });
  });

  it('closes for bad air even if cooler', () => {
    expect(decideHour(hour({ temp: 22, aqi: 180 }), 28)).toMatchObject({ open: false, reason: 'air' });
  });

  it('respects a stricter AQI limit for sensitive users', () => {
    expect(decideHour(hour({ temp: 22, aqi: 70 }), 28, { aqiLimit: 50 }).reason).toBe('air');
  });

  it('closes when it is too cold outside', () => {
    expect(decideHour(hour({ temp: 12 }), 22)).toMatchObject({ open: false, reason: 'cold' });
  });

  it('suggests fresh air when temperatures are about equal', () => {
    expect(decideHour(hour({ temp: 24 }), 24.3)).toMatchObject({ open: true, reason: 'fresh' });
  });

  it('works when air quality data is missing', () => {
    expect(decideHour(hour({ temp: 22, aqi: null }), 28).open).toBe(true);
  });
});

// A hot day: warm night (22°C low), 34°C afternoon.
const day = Array.from({ length: 24 }, (_, i) => {
  const temp = 28 + 6 * Math.sin(((i - 9) / 24) * 2 * Math.PI);
  return hour({ time: `2026-11-09T${String(i).padStart(2, '0')}:00`, temp });
});

describe('makePlan', () => {
  it('opens at night and closes in the afternoon heat', () => {
    const plan = makePlan(day, { startIndoor: 30 });
    expect(plan[3].open).toBe(true);
    expect(plan[14].open).toBe(false);
  });

  it('keeps the room cooler than leaving the window shut', () => {
    const s = summarize(makePlan(day, { startIndoor: 30 }));
    expect(s.peakPlan).toBeLessThan(s.peakShut);
    expect(s.saved).toBeGreaterThan(0);
  });

  it('returns an empty plan for no data', () => {
    expect(makePlan([])).toEqual([]);
    expect(summarize([])).toBeNull();
  });
});

describe('toBlocks', () => {
  it('merges runs of the same state', () => {
    const plan = makePlan(day, { startIndoor: 30 });
    const blocks = toBlocks(plan);
    expect(blocks.reduce((n, b) => n + b.hours, 0)).toBe(24);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i].open).not.toBe(blocks[i - 1].open);
  });
});
