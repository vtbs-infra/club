import type { Clock } from '../clock/clock.js';
import { RuntimeStatusTracker, type RuntimeStatus } from './runtime-status.js';

export interface PeriodicRuntime {
  close(): Promise<void>;
  getStatus(): RuntimeStatus;
  start(): Promise<void>;
  tick(): Promise<void>;
  requestTick(): void;
}

/** One in-flight task, retryable initialization, and a timer scheduled after each pass. */
export function createPeriodicRuntime(input: {
  readonly clock: Clock;
  readonly name: string;
  readonly intervalMs: number;
  readonly retryDelayMs?: number;
  readonly initialize?: () => Promise<void>;
  readonly run: () => Promise<void>;
  readonly reportError?: (error: unknown, operation: string) => void;
}): PeriodicRuntime {
  const status = new RuntimeStatusTracker(input.clock);
  const retryDelayMs = input.retryDelayMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: Promise<void> | null = null;
  let initialized = false;
  let enabled = false;
  let pending = false;
  let closed = false;

  const tick = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (active) return active;
    if (timer) clearTimeout(timer);
    timer = null;
    let nextDelay = input.intervalMs;
    active = Promise.resolve().then(async () => {
      try {
        if (closed) return;
        if (!initialized) {
          await input.initialize?.();
          initialized = true;
        }
        do {
          pending = false;
          if (closed) return;
          await input.run();
          status.markSuccess();
        } while (pending && !closed);
      } catch (error) {
        nextDelay = retryDelayMs;
        status.markFailure(error, new Date(input.clock.now().getTime() + retryDelayMs));
        input.reportError?.(error, input.name + '.tick');
        throw error;
      } finally {
        active = null;
        if (enabled && !closed) {
          timer = setTimeout(() => {
            timer = null;
            void tick().catch(() => undefined); // tick records and reports the failure.
          }, nextDelay);
          timer.unref();
        }
      }
    });
    return active;
  };

  return {
    async close() {
      closed = true;
      pending = false;
      if (timer) clearTimeout(timer);
      timer = null;
      if (active) await Promise.allSettled([active]);
      status.markStopped();
    },
    getStatus: () => status.get(),
    start() {
      if (closed || enabled) return active ?? Promise.resolve();
      enabled = true;
      status.markStarting();
      return tick();
    },
    tick,
    requestTick() {
      if (closed) return;
      pending = true;
      void tick().catch(() => undefined); // Demand changes coalesce into a subsequent pass.
    },
  };
}
