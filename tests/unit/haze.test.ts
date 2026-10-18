import { describe, expect, it } from 'vitest';
import pm from '../../src/content/data/smoketrail/pm25-daily.json';
import { aqiCategory, hazeCaption, hazeLevel, pickDay, type PmDay } from '../../src/lib/haze';

const days = (pm.days as PmDay[]).filter(([d]) => d.startsWith('2019-'));

describe('hero haze from SmokeTrail data', () => {
  it('has the 2019 season', () => {
    expect(days.length).toBeGreaterThan(80);
    expect(days[0][0] >= '2019-09-15').toBe(true);
  });

  it('picks the same calendar day in 2019 when in season', () => {
    expect(pickDay(days, new Date('2026-10-19T12:00'))[0]).toBe('2019-10-19');
  });

  it('picks the nearest season day out of season', () => {
    expect(pickDay(days, new Date('2026-07-01T12:00'))[0]).toBe(days[0][0]);
    expect(pickDay(days, new Date('2026-12-30T12:00'))[0]).toBe(days[days.length - 1][0]);
  });

  it('maps PM2.5 to India AQI categories and a bounded haze level', () => {
    expect(aqiCategory(25)).toBe('good');
    expect(aqiCategory(100)).toBe('poor');
    expect(aqiCategory(300)).toBe('severe');
    expect(hazeLevel(0)).toBe(0.12);
    expect(hazeLevel(1000)).toBe(0.9);
    expect(hazeCaption(['2019-11-03', 494.4])).toContain('PM2.5 494');
  });
});
