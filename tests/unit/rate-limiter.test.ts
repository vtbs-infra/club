import { describe, expect, it } from 'vitest';

import { InMemoryRateLimiter } from '../../src/server/infrastructure/security/request-security.js';

describe('in-memory request rate limiter', () => {
  it('limits a key within the configured window and resets afterward', () => {
    const limiter = new InMemoryRateLimiter(2, 1_000);

    expect(limiter.consume('user:ip', new Date(0)).allowed).toBe(true);
    expect(limiter.consume('user:ip', new Date(100)).allowed).toBe(true);
    expect(limiter.consume('user:ip', new Date(200))).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume('user:ip', new Date(1_001)).allowed).toBe(true);
  });

  it('isolates counters for independently supplied user and IP keys', () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    const now = new Date();

    expect(limiter.consume('user-a:ip-a', now).allowed).toBe(true);
    expect(limiter.consume('user-a:ip-a', now).allowed).toBe(false);
    expect(limiter.consume('user-a:ip-b', now).allowed).toBe(true);
    expect(limiter.consume('user-b:ip-a', now).allowed).toBe(true);
  });

  it('prunes expired keys and keeps cardinality bounded for many distinct clients', () => {
    const limiter = new InMemoryRateLimiter(2, 1_000, 100);

    for (let index = 0; index < 1_000; index += 1) {
      expect(limiter.consume(`ip:${index}`, new Date(0)).allowed).toBe(true);
    }
    expect(limiter.entryCount).toBeLessThanOrEqual(100);

    limiter.consume('ip:fresh', new Date(2_000));
    expect(limiter.entryCount).toBe(1);
  });

  it('rejects invalid resource limits', () => {
    expect(() => new InMemoryRateLimiter(1, 1_000, 0)).toThrow(RangeError);
  });
});
