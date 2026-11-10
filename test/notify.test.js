import { describe, it, expect, vi, afterEach } from 'vitest';
import { upcomingChanges, toEpoch, message, createScheduler } from '../src/notify.js';

const h = (time, open, text = 'reason') => ({ time, open, text, reason: 'x' });
const plan = [
  h('2026-11-09T22:00', true),
  h('2026-11-09T23:00', true),
  h('2026-11-10T00:00', false, 'Outdoor air is poor (AQI 120)'),
  h('2026-11-10T01:00', false),
  h('2026-11-10T02:00', true, 'Outside is cooler (21°C)'),
];

describe('upcomingChanges', () => {
  it('lists only the hours where the plan flips', () => {
    expect(upcomingChanges(plan).map((c) => [c.time, c.open])).toEqual([
      ['2026-11-10T00:00', false],
      ['2026-11-10T02:00', true],
    ]);
  });

  it('is empty when nothing changes', () => {
    expect(upcomingChanges([h('2026-11-09T22:00', false), h('2026-11-09T23:00', false)])).toEqual([]);
  });
});

describe('toEpoch', () => {
  it('converts place-local time using the UTC offset', () => {
    // 14:00 in India (UTC+5:30) is 08:30 UTC
    expect(new Date(toEpoch('2026-11-09T14:00', 19800)).toISOString()).toBe('2026-11-09T08:30:00.000Z');
  });

  it('handles negative offsets across midnight', () => {
    // 20:00 in New York (UTC-5) is 01:00 UTC the next day
    expect(new Date(toEpoch('2026-11-09T20:00', -18000)).toISOString()).toBe('2026-11-10T01:00:00.000Z');
  });
});

describe('message', () => {
  it('words open and close reminders', () => {
    expect(message({ open: true, text: 'Outside is cooler (21°C)' })).toEqual({
      title: 'Open your window now',
      body: 'Outside is cooler (21°C).',
    });
    expect(message({ open: false, text: 'Rain' }).title).toBe('Time to close your window');
  });
});

describe('createScheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('fires each future change once, at the right time', () => {
    vi.useFakeTimers();
    const start = toEpoch('2026-11-09T22:00', 0);
    vi.setSystemTime(start);
    const show = vi.fn();
    const s = createScheduler({ show });

    const next = s.schedule(plan, 0, 'Goa');
    expect(next.time).toBe('2026-11-10T00:00');

    vi.advanceTimersByTime(2 * 3600 * 1000 - 1);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].open).toBe(false);

    // Rescheduling after a refresh must not repeat a reminder already shown.
    s.schedule(plan, 0, 'Goa');
    vi.advanceTimersByTime(2 * 3600 * 1000);
    expect(show).toHaveBeenCalledTimes(2);
    expect(show.mock.calls[1][0].open).toBe(true);
  });

  it('clears old timers when the plan is replaced', () => {
    vi.useFakeTimers();
    vi.setSystemTime(toEpoch('2026-11-09T22:00', 0));
    const show = vi.fn();
    const s = createScheduler({ show });
    s.schedule(plan, 0, 'Goa');
    s.clear();
    vi.advanceTimersByTime(5 * 3600 * 1000);
    expect(show).not.toHaveBeenCalled();
  });
});
