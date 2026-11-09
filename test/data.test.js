import { describe, it, expect } from 'vitest';
import { mergeHourly, searchPlaces } from '../src/data.js';

const times = ['2026-11-09T10:00', '2026-11-09T11:00', '2026-11-09T12:00'];
const weather = {
  current: { time: '2026-11-09T11:15' },
  hourly: {
    time: times,
    temperature_2m: [25, 27, 29],
    apparent_temperature: [26, 28, 31],
    relative_humidity_2m: [70, 65, 60],
    precipitation_probability: [0, 10, 20],
    wind_speed_10m: [5, 6, 7],
  },
};
const air = { hourly: { time: times, us_aqi: [50, 80, 120], pm2_5: [10, 20, 40] } };

describe('mergeHourly', () => {
  it('starts at the current hour and joins air quality by time', () => {
    const hours = mergeHourly(weather, air);
    expect(hours).toHaveLength(2);
    expect(hours[0]).toMatchObject({ time: '2026-11-09T11:00', temp: 27, aqi: 80, pm25: 20, rainProb: 10 });
  });

  it('works without air quality data', () => {
    expect(mergeHourly(weather, null)[0].aqi).toBeNull();
  });
});

describe('searchPlaces', () => {
  it('maps geocoding results', async () => {
    const fake = async () => ({
      ok: true,
      json: async () => ({ results: [{ name: 'Panaji', admin1: 'Goa', country: 'India', latitude: 15.49, longitude: 73.82 }] }),
    });
    expect(await searchPlaces('panaji', fake)).toEqual([{ name: 'Panaji', region: 'Goa, India', lat: 15.49, lon: 73.82 }]);
  });

  it('skips blank searches', async () => {
    expect(await searchPlaces('  ')).toEqual([]);
  });
});
