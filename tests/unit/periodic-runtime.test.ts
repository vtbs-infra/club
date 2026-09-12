import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPeriodicRuntime } from '../../src/server/infrastructure/runtime/periodic-runtime.js';
import { createSnapshotRuntime } from '../../src/server/modules/snapshots/snapshot-runtime.js';

const clock = { now: () => new Date() };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('periodic runtime', () => {
  it('retries failed startup and does not repeat successful recovery after a later failure', async () => {
    vi.useFakeTimers();
    const initialize = vi
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(undefined);
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('task unavailable'))
      .mockResolvedValue(undefined);
    const reportError = vi.fn();
    const runtime = createPeriodicRuntime({
      clock,
      name: 'test',
      intervalMs: 1000,
      retryDelayMs: 100,
      initialize,
      run,
      reportError,
    });
    await expect(runtime.start()).rejects.toThrow('database unavailable');
    expect(runtime.getStatus().state).toBe('DEGRADED');
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(runtime.getStatus().state).toBe('RUNNING');
    expect(runtime.getStatus().nextRetryAt).toBeNull();
    await runtime.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares in-flight ticks and merges demand changes into one subsequent pass', async () => {
    const gate = deferred();
    const entered = deferred();
    const run = vi.fn(async () => {
      entered.resolve();
      await gate.promise;
    });
    const runtime = createPeriodicRuntime({ clock, name: 'identity', intervalMs: 1000, run });
    const first = runtime.tick();
    await entered.promise;
    const concurrent = runtime.tick();
    runtime.requestTick();
    runtime.requestTick();
    expect(run).toHaveBeenCalledOnce();
    gate.resolve();
    await Promise.all([first, concurrent]);
    expect(run).toHaveBeenCalledTimes(2);
    await runtime.close();
  });

  it('waits for in-flight work and discards pending demand when stopped', async () => {
    const gate = deferred();
    const entered = deferred();
    const run = vi.fn(async () => {
      entered.resolve();
      await gate.promise;
    });
    const runtime = createPeriodicRuntime({ clock, name: 'test', intervalMs: 1000, run });
    const starting = runtime.start();
    await entered.promise;
    runtime.requestTick();
    let stopped = false;
    const closing = runtime.close().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    gate.resolve();
    await Promise.all([starting, closing]);
    await runtime.start();
    await runtime.tick();
    expect(run).toHaveBeenCalledOnce();
    expect(runtime.getStatus().state).toBe('STOPPED');
  });

  it('cleans temporary objects before capture and aborts then drains captures during shutdown', async () => {
    const events: string[] = [];
    const entered = deferred();
    const capture = deferred();
    const idle = deferred();
    const runtime = createSnapshotRuntime({
      clock,
      storage: {
        cleanupStaleTemporaryObjects: () => {
          events.push('cleanup');
          return Promise.resolve(0);
        },
      },
      service: {
        precreateRuns: () => {
          events.push('precreate');
          return Promise.resolve(0);
        },
        runDue: async () => {
          events.push('capture');
          entered.resolve();
          await capture.promise;
          return 0;
        },
        beginShutdown: () => {
          events.push('abort');
          capture.resolve();
        },
        waitForIdle: async () => {
          events.push('drain');
          await idle.promise;
        },
      },
    });
    const starting = runtime.start();
    await entered.promise;
    const closing = runtime.close();
    await starting;
    await vi.waitFor(() =>
      expect(events).toEqual(['cleanup', 'precreate', 'capture', 'abort', 'drain']),
    );
    idle.resolve();
    await closing;
    expect(runtime.getStatus().state).toBe('STOPPED');
  });
});
