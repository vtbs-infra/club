import { describe, expect, it } from 'vitest';

import {
  calculateMonthlyCutoff,
  classifyPunctuality,
  normalizeIanaTimezone,
  relevantMonthlyPeriods,
} from '../../src/server/modules/snapshots/month-end.js';

describe('monthly snapshot timing', () => {
  it('calculates the last-day observation window in Asia/Shanghai', () => {
    const cutoff = calculateMonthlyCutoff('2026-07-01', 'Asia/Shanghai');
    expect(cutoff.scheduledCutoffAt.toISOString()).toBe('2026-07-31T15:59:00.000Z');
    expect(cutoff.onTimeWindowEndAt.toISOString()).toBe('2026-07-31T16:00:00.000Z');
  });

  it('handles leap months and a cross-year cutoff in different IANA zones', () => {
    expect(
      calculateMonthlyCutoff('2028-02-01', 'Europe/Paris').scheduledCutoffAt.toISOString(),
    ).toBe('2028-02-29T22:59:00.000Z');
    expect(
      calculateMonthlyCutoff('2026-12-01', 'America/New_York').scheduledCutoffAt.toISOString(),
    ).toBe('2027-01-01T04:59:00.000Z');
  });

  it('classifies by capture start and keeps the end boundary late', () => {
    const start = new Date('2026-07-31T15:59:00.000Z');
    const end = new Date('2026-07-31T16:00:00.000Z');
    expect(classifyPunctuality(start, start, end)).toBe('ON_TIME');
    expect(classifyPunctuality(new Date(end.getTime() - 1), start, end)).toBe('ON_TIME');
    expect(classifyPunctuality(end, start, end)).toBe('LATE');
  });

  it('returns current and next periods across a year boundary', () => {
    expect(relevantMonthlyPeriods(new Date('2026-12-31T16:30:00.000Z'), 'Asia/Shanghai')).toEqual([
      '2027-01-01',
      '2027-02-01',
    ]);
  });

  it('rejects offsets and unknown time zones', () => {
    expect(() => normalizeIanaTimezone('+08:00')).toThrow();
    expect(() => normalizeIanaTimezone('Mars/Olympus')).toThrow();
    expect(() => calculateMonthlyCutoff('2026-07-02', 'Asia/Shanghai')).toThrow();
  });
});
