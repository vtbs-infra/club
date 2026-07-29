import { describe, expect, it } from 'vitest';

import {
  dateTimeLocalToIso,
  epochMillisecondsToDateTimeLocal,
  isoToDateTimeLocal,
} from '../../src/web/lib/date-time.js';

describe('business date-time conversion', () => {
  it('round-trips Asia/Shanghai across a UTC day boundary', () => {
    expect(isoToDateTimeLocal('2026-07-29T16:30:00.000Z', 'Asia/Shanghai')).toBe(
      '2026-07-30T00:30',
    );
    expect(dateTimeLocalToIso('2026-07-30T00:30', 'Asia/Shanghai')).toBe('2026-07-29T16:30:00Z');
  });

  it('keeps UTC wall-clock input unchanged', () => {
    expect(isoToDateTimeLocal('2026-07-29T16:30:00.000Z', 'UTC')).toBe('2026-07-29T16:30');
    expect(dateTimeLocalToIso('2026-07-29T16:30', 'UTC')).toBe('2026-07-29T16:30:00Z');
  });

  it('creates defaults in the requested business timezone', () => {
    const epoch = Date.parse('2026-07-29T16:30:00.000Z');
    expect(epochMillisecondsToDateTimeLocal(epoch, 'Asia/Shanghai')).toBe('2026-07-30T00:30');
    expect(epochMillisecondsToDateTimeLocal(epoch, 'UTC')).toBe('2026-07-29T16:30');
  });
});
