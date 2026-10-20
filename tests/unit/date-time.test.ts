import { describe, expect, it } from 'vitest';

import { toLocalDateTime } from '../../src/web/lib/date-time.js';

describe('local date-time display', () => {
  it('shows an instant in the requested time zone across a UTC day boundary', () => {
    expect(toLocalDateTime('2026-07-29T16:30:00.000Z', 'Asia/Shanghai')).toBe('2026-07-30T00:30');
    expect(toLocalDateTime('2026-07-29T16:30:00.000Z', 'UTC')).toBe('2026-07-29T16:30');
  });

  it('accepts epoch milliseconds and keeps midnight as hour 00', () => {
    expect(toLocalDateTime(Date.parse('2026-07-29T16:00:00.000Z'), 'Asia/Shanghai')).toBe(
      '2026-07-30T00:00',
    );
  });
});
