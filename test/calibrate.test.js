import { describe as group, it, expect } from 'vitest';
import { calibrate, usablePairs, replay, describe } from '../src/calibrate.js';
import { modelParams } from '../src/engine.js';

const HOUR = 3600 * 1000;
const t0 = Date.UTC(2026, 10, 9, 0); // midnight UTC; local hour = UTC hour here

// 36 hours of outdoor temperature: cool nights, hot afternoons.
const series = Array.from({ length: 36 }, (_, i) => ({
  at: t0 + i * HOUR,
  hour: i % 24,
  temp: 28 + 6 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI),
}));

// Generate "true" readings from a room with known settings, then check we recover them.
function readingsFor(trueParams, plan) {
  const out = [{ at: plan[0].at, temp: 30, open: false }];
  for (let i = 1; i < plan.length; i++) {
    const prev = out[i - 1];
    const next = { at: plan[i].at, open: plan[i].open, temp: 0 };
    next.temp = replay(prev, next, series, trueParams);
    out.push(next);
  }
  return out;
}

group('usablePairs', () => {
  it('keeps readings 1–12 hours apart', () => {
    const r = [
      { at: t0, temp: 30 },
      { at: t0 + 30 * 60 * 1000, temp: 30 }, // 30 min: too close
      { at: t0 + 3 * HOUR, temp: 29 },
      { at: t0 + 20 * HOUR, temp: 31 }, // 17 h gap: too far
    ];
    expect(usablePairs(r)).toHaveLength(1);
  });
});

group('calibrate', () => {
  it('needs at least two usable gaps between readings', () => {
    expect(calibrate([{ at: t0, temp: 30, open: false }], series)).toBeNull();
    expect(
      calibrate([{ at: t0 + 10 * HOUR, temp: 27.5, open: false }, { at: t0 + 12 * HOUR, temp: 30, open: false }], series),
    ).toBeNull();
  });

  it('does not invent an extreme room from a few readings', () => {
    const cal = calibrate(
      [
        { at: t0 + 9 * HOUR, temp: 27.5, open: false },
        { at: t0 + 11 * HOUR, temp: 30, open: false },
        { at: t0 + 13 * HOUR, temp: 31, open: false },
      ],
      series,
    );
    expect(cal.sunScale).toBeLessThanOrEqual(2.2);
    expect(cal.closedMix).toBeLessThanOrEqual(0.25);
  });

  it('recovers a leaky, sunny room from closed-window readings', () => {
    const truth = { ...modelParams({}), closedMix: 0.15, sunScale: 2 };
    const readings = readingsFor(truth, [
      { at: t0 + 6 * HOUR },
      { at: t0 + 10 * HOUR, open: false },
      { at: t0 + 14 * HOUR, open: false },
      { at: t0 + 18 * HOUR, open: false },
    ]);
    const cal = calibrate(readings, series);
    // The gentle pull toward typical values means "close", not exact.
    expect(cal.closedMix).toBeGreaterThan(0.11);
    expect(cal.sunScale).toBeGreaterThan(1.5);
    expect(describe(cal)).toMatch(/faster than average/);
  });

  it('learns how fast the room airs out from open-window readings', () => {
    const truth = { ...modelParams({}), openMix: 0.3 };
    const readings = readingsFor(truth, [
      { at: t0 + 0 * HOUR },
      { at: t0 + 3 * HOUR, open: true },
      { at: t0 + 6 * HOUR, open: true },
    ]);
    const cal = calibrate(readings, series);
    expect(cal.openMix).toBeLessThan(0.4);
    expect(describe(cal)).toMatch(/airs out slowly/);
  });

  it('skips pairs with no weather data', () => {
    const r = [
      { at: t0 + 100 * HOUR, temp: 30, open: false },
      { at: t0 + 103 * HOUR, temp: 31, open: false },
    ];
    expect(calibrate(r, series)).toBeNull();
  });
});
