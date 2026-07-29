import type { AppConfig } from '../../config/env.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import {
  RuntimeStatusTracker,
  type RuntimeStatus,
} from '../../infrastructure/runtime/runtime-status.js';
import { FakeGuardRosterSource } from '../bilibili/fake-guard-roster-source.js';
import type { GuardRosterSource } from '../bilibili/guard-roster-source.js';
import { PublicWebGuardRosterSource } from '../bilibili/public-web-guard-roster-source.js';
import { SnapshotService } from './snapshot-service.js';

export interface SnapshotRuntime {
  readonly service: SnapshotService;
  readonly source: GuardRosterSource;
  close(): Promise<void>;
  getStatus(): RuntimeStatus;
  start(): Promise<void>;
  tick(): Promise<void>;
}

export function createSnapshotRuntime(input: {
  readonly clock: Clock;
  readonly config: AppConfig;
  readonly database: DatabaseService;
  readonly maxDurationMs?: number;
  readonly onFinalized?: (runId: string, executor: AppDatabase) => Promise<unknown>;
  readonly reportError?: (error: unknown, operation: string) => void;
  readonly retryDelayMs?: number;
  readonly source?: GuardRosterSource;
  readonly storage: StorageDriver;
}): SnapshotRuntime {
  const source =
    input.source ??
    (input.config.bilibiliRosterSource === 'fake'
      ? new FakeGuardRosterSource()
      : new PublicWebGuardRosterSource());
  const service = new SnapshotService(
    input.database,
    input.storage,
    source,
    input.clock,
    input.maxDurationMs,
    input.onFinalized,
  );
  let interval: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let starting: Promise<void> | null = null;
  let activeTick: Promise<void> | null = null;
  let closed = false;
  const retryDelayMs = input.retryDelayMs ?? 30_000;
  const status = new RuntimeStatusTracker(input.clock);
  const tick = (): Promise<void> => {
    if (activeTick) return activeTick;
    activeTick = (async () => {
      try {
        await service.precreateRuns();
        await service.runDue();
        status.markSuccess();
      } catch (error) {
        status.markFailure(error, new Date(input.clock.now().getTime() + 30_000));
        input.reportError?.(error, 'snapshot.tick');
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
      void start().catch((error) => input.reportError?.(error, 'snapshot.retry'));
    }, retryDelayMs);
    retryTimer.unref();
  };
  const start = async (): Promise<void> => {
    if (closed || interval) return;
    if (starting) return starting;
    status.markStarting();
    starting = (async () => {
      try {
        await input.storage.cleanupStaleTemporaryObjects(
          new Date(input.clock.now().getTime() - 60 * 60_000),
        );
        await service.recoverInterrupted();
        await service.precreateRuns();
        await tick();
        if (closed) return;
        interval = setInterval(
          () => void tick().catch((error) => input.reportError?.(error, 'snapshot.timer')),
          30_000,
        );
        interval.unref();
      } catch (error) {
        status.markFailure(error, new Date(input.clock.now().getTime() + retryDelayMs));
        input.reportError?.(error, 'snapshot.start');
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
    source,
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
