import { Temporal } from 'temporal-polyfill';

import { AppError } from '../../../shared/errors/app-error.js';

/** Returns the canonical IANA name. UTC offsets such as `+08:00` do not follow daylight saving. */
export function normalizeIanaTimezone(timezone: string): string {
  if (/^[+-]/.test(timezone)) throw new RangeError('An IANA timezone name is required.');
  return new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
}

/**
 * Converts a wall-clock `YYYY-MM-DDTHH:mm` value to an instant in the time zone it was entered in.
 * Times skipped or repeated by a daylight-saving change are rejected rather than silently shifted.
 */
export function localDateTimeToInstant(value: string, timeZone: string): Date {
  let zone: string;
  try {
    zone = normalizeIanaTimezone(timeZone);
  } catch {
    throw new AppError('TIME_ZONE_INVALID', 'A valid IANA time zone is required.', 400);
  }
  try {
    const instant = Temporal.PlainDateTime.from(value)
      .toZonedDateTime(zone, { disambiguation: 'reject' })
      .toInstant();
    return new Date(instant.epochMilliseconds);
  } catch {
    throw new AppError('LOCAL_TIME_INVALID', `This time does not exist in ${zone}.`, 400);
  }
}
