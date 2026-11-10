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

import { pm25ToAqi } from '../src/engine.js';
import { allowedEndpoint, vapidJwt } from '../worker/push.js';
import { findDue } from '../worker/reminders.js';
import { parseCommand } from '../worker/telegram.js';
import { pickStation } from '../worker/sensors.js';
import { toEpoch } from '../src/notify.js';

describe('server features', () => {
  it('converts PM2.5 to US AQI', () => {
    expect(pm25ToAqi(0)).toBe(0);
    expect(pm25ToAqi(9)).toBe(50);
    expect(pm25ToAqi(35.4)).toBe(100);
    expect(pm25ToAqi(55.5)).toBe(151);
    expect(pm25ToAqi(1000)).toBe(500);
    expect(pm25ToAqi(-1)).toBeNull();
  });

  it('only pushes to known push services', () => {
    expect(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(allowedEndpoint('https://web.push.apple.com/xyz')).toBe(true);
    expect(allowedEndpoint('https://evil.example.com/fcm.googleapis.com')).toBe(false);
    expect(allowedEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(allowedEndpoint('nope')).toBe(false);
  });

  it('signs a valid VAPID token', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const jwt = await vapidJwt(jwk, 'https://fcm.googleapis.com', 'https://example.com', Date.UTC(2026, 10, 10));
    const [h, c, sig] = jwt.split('.');
    const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(dec(c)))).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://example.com' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, dec(sig), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('finds a change that is due within the next 10 minutes', () => {
    const plan = [
      { time: '2026-11-10T20:00', open: false, reason: 'heat' },
      { time: '2026-11-10T21:00', open: true, reason: 'cool' },
    ];
    const at = toEpoch('2026-11-10T21:00', 19800);
    expect(findDue(plan, 19800, at - 30 * 60e3)).toBeNull();
    expect(findDue(plan, 19800, at - 5 * 60e3)).toMatchObject({ time: '2026-11-10T21:00', open: true });
    expect(findDue(plan, 19800, at + 2 * 60e3)).not.toBeNull();
    expect(findDue(plan, 19800, at + 20 * 60e3)).toBeNull();
  });

  it('parses Telegram commands', () => {
    expect(parseCommand('/start AbC123')).toEqual({ cmd: 'start', arg: 'AbC123' });
    expect(parseCommand('/STOP@WindowWiseBot')).toEqual({ cmd: 'stop', arg: '' });
    expect(parseCommand('hello')).toEqual({ cmd: '', arg: '' });
  });

  it('picks the nearest recent PM2.5 station', () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const loc = (id, lat, lon, hoursAgo, pm = true) => ({
      id,
      name: `S${id}`,
      coordinates: { latitude: lat, longitude: lon },
      datetimeLast: { utc: new Date(now - hoursAgo * 3600e3).toISOString() },
      sensors: [{ id: id * 10, parameter: { name: pm ? 'pm25' : 'o3' } }],
    });
    const here = { lat: 15.4, lon: 73.8 };
    const pick = pickStation([loc(1, 15.5, 73.8, 1), loc(2, 15.41, 73.81, 5), loc(3, 15.42, 73.8, 0.5, false), loc(4, 15.45, 73.8, 0.5)], here, now);
    expect(pick.id).toBe(4); // 2 is stale, 3 has no PM2.5
    expect(pick.sensorId).toBe(40);
  });
});
