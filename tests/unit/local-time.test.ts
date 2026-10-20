import { describe, expect, it } from 'vitest';

import {
  localDateTimeToInstant,
  normalizeIanaTimezone,
} from '../../src/server/infrastructure/clock/local-time.js';

describe('local date-time conversion', () => {
  it('interprets wall-clock time in the given time zone', () => {
    expect(localDateTimeToInstant('2026-07-30T00:30', 'Asia/Shanghai').toISOString()).toBe(
      '2026-07-29T16:30:00.000Z',
    );
    expect(localDateTimeToInstant('2026-07-29T16:30', 'UTC').toISOString()).toBe(
      '2026-07-29T16:30:00.000Z',
    );
  });

  it('rejects times skipped or repeated by a daylight-saving change', () => {
    expect(() => localDateTimeToInstant('2026-03-08T02:30', 'America/Los_Angeles')).toThrow(
      expect.objectContaining({ code: 'LOCAL_TIME_INVALID', statusCode: 400 }),
    );
    expect(() => localDateTimeToInstant('2026-11-01T01:30', 'America/Los_Angeles')).toThrow(
      expect.objectContaining({ code: 'LOCAL_TIME_INVALID' }),
    );
  });

  it('accepts only IANA time zone names', () => {
    expect(normalizeIanaTimezone('asia/shanghai')).toBe('Asia/Shanghai');
    for (const zone of ['+08:00', 'Mars/Olympus']) {
      expect(() => normalizeIanaTimezone(zone)).toThrow();
      expect(() => localDateTimeToInstant('2026-07-30T00:30', zone)).toThrow(
        expect.objectContaining({ code: 'TIME_ZONE_INVALID', statusCode: 400 }),
      );
    }
  });
});
