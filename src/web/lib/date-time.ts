import { Temporal } from '@js-temporal/polyfill';

export const PLATFORM_TIME_ZONE = 'Asia/Shanghai';

export function isoToDateTimeLocal(iso: string, timeZone: string): string {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}

export function dateTimeLocalToIso(value: string, timeZone: string): string {
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timeZone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}

export function epochMillisecondsToDateTimeLocal(
  epochMilliseconds: number,
  timeZone: string,
): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}
