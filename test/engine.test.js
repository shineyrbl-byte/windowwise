import { describe, it, expect } from 'vitest';
import { decideHour, makePlan, toBlocks, summarize, bestAirHour, sunGain, step, modelParams, pollenRisk } from '../src/engine.js';

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

describe('bestAirHour', () => {
  it('picks the cleanest dry hour', () => {
    const plan = makePlan([
      hour({ time: '2026-11-09T01:00', aqi: 190 }),
      hour({ time: '2026-11-09T02:00', aqi: 120, rainProb: 90 }),
      hour({ time: '2026-11-09T03:00', aqi: 150 }),
    ]);
    expect(bestAirHour(plan).time).toBe('2026-11-09T03:00');
  });

  it('prefers hourly PM2.5 over the slow-moving AQI', () => {
    const plan = makePlan([
      hour({ time: '2026-11-09T01:00', aqi: 180, pm25: 120 }),
      hour({ time: '2026-11-09T02:00', aqi: 180, pm25: 60 }),
    ]);
    expect(bestAirHour(plan).time).toBe('2026-11-09T02:00');
  });

  it('returns null without air data', () => {
    expect(bestAirHour(makePlan([hour({ aqi: null })]))).toBeNull();
  });
});

describe('window sun and fan', () => {
  it('heats a morning-sun room in the morning and an afternoon-sun room later', () => {
    expect(sunGain(9, 'morning')).toBeGreaterThan(sunGain(9, 'afternoon'));
    expect(sunGain(15, 'afternoon')).toBeGreaterThan(sunGain(15, 'morning'));
    expect(sunGain(2, 'allday')).toBe(0);
  });

  it('a shaded room warms less than an unsure one', () => {
    const shade = summarize(makePlan(day, { startIndoor: 30, sun: 'shade' }));
    const unsure = summarize(makePlan(day, { startIndoor: 30 }));
    expect(shade.peakShut).toBeLessThan(unsure.peakShut);
  });

  it('a fan cools the room faster with the window open', () => {
    const noFan = step(30, 22, true, 2, modelParams({ fan: false }));
    const fan = step(30, 22, true, 2, modelParams({ fan: true }));
    expect(fan).toBeLessThan(noFan);
  });

  it('uses calibrated values when present', () => {
    expect(modelParams({ closedMix: 0.15, sunScale: 1.5 })).toMatchObject({ closedMix: 0.15, sunScale: 1.5 });
  });
});

describe('pollen', () => {
  it('finds the pollen closest to its high level', () => {
    expect(pollenRisk({ grass: 25, ragweed: 30 })).toMatchObject({ type: 'ragweed', name: 'Ragweed' });
    expect(pollenRisk(null)).toBeNull();
  });

  it('closes for high pollen only when the user has an allergy', () => {
    const h = hour({ temp: 22, pollen: { grass: 80 } });
    expect(decideHour(h, 28).open).toBe(true);
    expect(decideHour(h, 28, { pollenAllergy: true })).toMatchObject({ open: false, reason: 'pollen' });
  });

  it('ignores missing pollen data', () => {
    expect(decideHour(hour({ temp: 22, pollen: null }), 28, { pollenAllergy: true }).open).toBe(true);
  });
});

import { overnight, warmestAiringHour, curtainHours, energySaved, daySummaries } from '../src/engine.js';

describe('more rules', () => {
  it('closes for strong wind gusts', () => {
    expect(decideHour(hour({ temp: 22, gust: 70 }), 28)).toMatchObject({ open: false, reason: 'wind' });
    expect(decideHour(hour({ temp: 22, gust: 30 }), 28).open).toBe(true);
  });

  it('damp mode dries the room with drier outside air, even if warmer', () => {
    expect(decideHour(hour({ temp: 30, humidity: 55 }), 27, { damp: true })).toMatchObject({ open: true, reason: 'dry' });
    expect(decideHour(hour({ temp: 22, humidity: 92 }), 28, { damp: true })).toMatchObject({ open: false, reason: 'damp' });
    expect(decideHour(hour({ temp: 30, humidity: 55 }), 27).open).toBe(false);
  });

  it('cross-ventilation and a fan both speed up airing', () => {
    const base = modelParams({}).openMix;
    expect(modelParams({ crossVent: true }).openMix).toBeGreaterThan(base);
    expect(modelParams({ crossVent: true, fan: true }).openMix).toBeGreaterThan(modelParams({ crossVent: true }).openMix);
  });

  it('curtains and clouds cut sun heat', () => {
    const p = modelParams({ sun: 'afternoon' });
    const pc = modelParams({ sun: 'afternoon', curtains: true });
    const clear = step(28, 28, false, 15, p, 0);
    expect(step(28, 28, false, 15, pc, 0)).toBeLessThan(clear);
    expect(step(28, 28, false, 15, p, 100)).toBeLessThan(clear);
  });
});

describe('summaries', () => {
  const night = (i, open) => ({ time: `2026-11-09T${String(i).padStart(2, '0')}:00`, open, reason: open ? 'cool' : 'heat', temp: 20 + i / 2 });
  const plan = [18, 19, 20, 21, 22, 23].map((i) => night(i, i >= 22)).concat(
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ ...night(i, i <= 5), time: `2026-11-10T${String(i).padStart(2, '0')}:00` })),
  );

  it('finds the longest open stretch tonight', () => {
    const o = overnight(plan);
    expect(o.best.start.time).toBe('2026-11-09T22:00');
    expect(o.best.end.time).toBe('2026-11-10T05:00');
    expect(o.best.hours).toBe(8);
  });

  it('reports why the window stays shut all night', () => {
    const o = overnight(plan.map((h) => ({ ...h, open: false, reason: 'air' })));
    expect(o.best).toBeNull();
    expect(o.closedBecause.reason).toBe('air');
  });

  it('picks the warmest safe hour on cold days', () => {
    const p = [
      { time: 'a', temp: 10, reason: 'cold' },
      { time: 'b', temp: 15, reason: 'rain' },
      { time: 'c', temp: 13, reason: 'cold' },
    ];
    expect(warmestAiringHour(p).time).toBe('c');
  });

  it('suggests curtains for sunny closed hours', () => {
    const p = makePlan(day, { startIndoor: 30, sun: 'afternoon' });
    const c = curtainHours(p, { sun: 'afternoon' });
    expect(c.hours).toBeGreaterThan(0);
    expect(curtainHours(p, { sun: 'shade' })).toBeNull();
    // A cold room wants the sun's heat.
    const cold = makePlan(day.map((h) => ({ ...h, temp: h.temp - 15 })), { startIndoor: 15, sun: 'afternoon' });
    expect(curtainHours(cold, { sun: 'afternoon' })).toBeNull();
    // One stretch only, never wrapping into the next day.
    expect(c.to.time >= c.from.time).toBe(true);
  });

  it('counts AC hours, energy and money the plan saves', () => {
    const p = [
      { indoorPlan: 30, indoorShut: 30 },
      { indoorPlan: 25, indoorShut: 29 },
      { indoorPlan: 27, indoorShut: 29 },
      { indoorPlan: 24, indoorShut: 25 },
    ];
    expect(energySaved(p, { comfortMax: 26, acKw: 1, tariff: 10 })).toMatchObject({ hours: 1, kwh: 1, money: 10 });
  });

  it('summarises each day', () => {
    const p = makePlan(
      Array.from({ length: 48 }, (_, i) => hour({ time: `2026-11-${i < 24 ? '09' : '10'}T${String(i % 24).padStart(2, '0')}:00`, temp: 20 + (i % 24) / 2, aqi: 50 + i })),
      { startIndoor: 28 },
    );
    const days = daySummaries(p);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: '2026-11-09', hours: 24, min: 20, maxAqi: 73 });
    expect(days[0].night).not.toBeNull();
  });
});
