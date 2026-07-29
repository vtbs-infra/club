import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import { RuntimeStatusTracker } from '../../src/server/infrastructure/runtime/runtime-status.js';

class MutableClock implements Clock {
  public constructor(public current: Date) {}
  public now(): Date {
    return new Date(this.current);
  }
}

describe('runtime status', () => {
  it('records startup, degradation, retry, recovery, and shutdown', () => {
    const clock = new MutableClock(new Date('2026-07-29T10:00:00.000Z'));
    const status = new RuntimeStatusTracker(clock);

    status.markStarting();
    expect(status.get()).toMatchObject({
      startedAt: clock.current,
      state: 'STARTING',
    });

    clock.current = new Date('2026-07-29T10:00:01.000Z');
    status.markFailure(
      Object.assign(new Error('temporary failure'), { code: 'TEMPORARY_FAILURE' }),
      new Date('2026-07-29T10:00:31.000Z'),
    );
    expect(status.get()).toMatchObject({
      lastErrorAt: clock.current,
      lastErrorCode: 'TEMPORARY_FAILURE',
      nextRetryAt: new Date('2026-07-29T10:00:31.000Z'),
      state: 'DEGRADED',
    });

    clock.current = new Date('2026-07-29T10:00:31.000Z');
    status.markSuccess();
    expect(status.get()).toMatchObject({
      lastSuccessAt: clock.current,
      lastTickAt: clock.current,
      nextRetryAt: null,
      state: 'RUNNING',
    });

    status.markStopped();
    expect(status.get().state).toBe('STOPPED');
  });
});
