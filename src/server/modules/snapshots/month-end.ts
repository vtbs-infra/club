import { Temporal } from '@js-temporal/polyfill';

export interface MonthlyCutoff {
  readonly cutoffTimezone: string;
  readonly onTimeWindowEndAt: Date;
  readonly periodStart: string;
  readonly scheduledCutoffAt: Date;
}

export function normalizeIanaTimezone(timezone: string): string {
  if (/^[+-]/.test(timezone)) throw new RangeError('An IANA timezone name is required.');
  return new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
}

export function calculateMonthlyCutoff(periodStart: string, timezone: string): MonthlyCutoff {
  const cutoffTimezone = normalizeIanaTimezone(timezone);
  const period = Temporal.PlainDate.from(periodStart);
  if (period.day !== 1) throw new RangeError('A monthly period must start on the first day.');
  const month = period.toPlainYearMonth();
  const lastDay = month.toPlainDate({ day: month.daysInMonth });
  const cutoff = lastDay.toZonedDateTime({
    plainTime: Temporal.PlainTime.from('23:59:00'),
    timeZone: cutoffTimezone,
  });
  return {
    cutoffTimezone,
    onTimeWindowEndAt: new Date(cutoff.add({ minutes: 1 }).epochMilliseconds),
    periodStart: period.toString(),
    scheduledCutoffAt: new Date(cutoff.epochMilliseconds),
  };
}

export function relevantMonthlyPeriods(now: Date, timezone: string): readonly [string, string] {
  const zone = normalizeIanaTimezone(timezone);
  const zoned = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(zone);
  const current = Temporal.PlainYearMonth.from({ month: zoned.month, year: zoned.year });
  return [
    current.toPlainDate({ day: 1 }).toString(),
    current.add({ months: 1 }).toPlainDate({ day: 1 }).toString(),
  ];
}

export function classifyPunctuality(
  captureStartedAt: Date,
  scheduledCutoffAt: Date,
  onTimeWindowEndAt: Date,
): 'ON_TIME' | 'LATE' {
  return captureStartedAt >= scheduledCutoffAt && captureStartedAt < onTimeWindowEndAt
    ? 'ON_TIME'
    : 'LATE';
}
