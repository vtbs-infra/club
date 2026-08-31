import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  RuntimeStatusTracker,
  type RuntimeStatus,
} from '../../infrastructure/runtime/runtime-status.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import { GiftMediaService, GIFT_COVER_STAGED_SAFETY_MS } from './gift-media-service.js';

export interface GiftMediaRuntime {
  readonly service: GiftMediaService;
  close(): Promise<void>;
  getStatus(): RuntimeStatus;
  start(): Promise<void>;
  tick(): Promise<void>;
}

export function createGiftMediaRuntime(input: {
  readonly clock: Clock;
  readonly database: DatabaseService;
  readonly intervalMs?: number;
  readonly reportError?: (error: unknown, operation: string) => void;
  readonly retryDelayMs?: number;
  readonly stagedSafetyMs?: number;
  readonly storage: StorageDriver;
}): GiftMediaRuntime {
  const service = new GiftMediaService(input.database, input.storage, input.clock);
  const intervalMs = input.intervalMs ?? 5 * 60_000;
  const retryDelayMs = input.retryDelayMs ?? 30_000;
  const stagedSafetyMs = input.stagedSafetyMs ?? GIFT_COVER_STAGED_SAFETY_MS;
  const status = new RuntimeStatusTracker(input.clock);
  let interval: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let starting: Promise<void> | null = null;
  let activeTick: Promise<void> | null = null;
  let closed = false;

  const tick = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (activeTick) return activeTick;
    activeTick = (async () => {
      try {
        await service.cleanupObjects(new Date(input.clock.now().getTime() - stagedSafetyMs));
        status.markSuccess();
      } catch (error) {
        status.markFailure(error, new Date(input.clock.now().getTime() + retryDelayMs));
        input.reportError?.(error, 'gift-media.tick');
        throw error;
      } finally {
        activeTick = null;
      }
    })();
    return activeTick;
  };

  const scheduleStartRetry = (): void => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void start().catch((error) => input.reportError?.(error, 'gift-media.retry'));
    }, retryDelayMs);
    retryTimer.unref();
  };

  const start = async (): Promise<void> => {
    if (closed || interval) return;
    if (starting) return starting;
    status.markStarting();
    starting = (async () => {
      try {
        await tick();
        if (closed) return;
        interval = setInterval(
          () => void tick().catch((error) => input.reportError?.(error, 'gift-media.timer')),
          intervalMs,
        );
        interval.unref();
      } catch (error) {
        status.markFailure(error, new Date(input.clock.now().getTime() + retryDelayMs));
        input.reportError?.(error, 'gift-media.start');
        scheduleStartRetry();
        throw error;
      } finally {
        starting = null;
      }
    })();
    return starting;
  };

  return {
    service,
    async close() {
      closed = true;
      if (interval) clearInterval(interval);
      interval = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      await Promise.allSettled([starting, activeTick].filter((task) => task !== null));
      status.markStopped();
    },
    getStatus: () => status.get(),
    start,
    tick,
  };
}
