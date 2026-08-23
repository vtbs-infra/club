import { describe, expect, it } from 'vitest';

import { relativeDeadline } from '../../src/web/lib/format.js';

describe('relative deadline formatting', () => {
  const now = new Date(2026, 7, 24, 10).getTime();

  it('uses calendar days for today and tomorrow', () => {
    expect(relativeDeadline(new Date(2026, 7, 24, 11).toISOString(), now)).toBe('今天截止');
    expect(relativeDeadline(new Date(2026, 7, 25, 1).toISOString(), now)).toBe('明天截止');
  });

  it('marks a deadline as ended immediately after it passes', () => {
    expect(relativeDeadline(new Date(now - 1).toISOString(), now)).toBe('领取期已结束');
  });

  it('keeps short future deadlines concise', () => {
    expect(relativeDeadline(new Date(2026, 7, 27, 10).toISOString(), now)).toBe('3 天后截止');
  });
});
