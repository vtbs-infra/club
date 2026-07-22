import type { AppConfig } from '../../config/env.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import { FakeGuardRosterSource } from '../bilibili/fake-guard-roster-source.js';
import type { GuardRosterSource } from '../bilibili/guard-roster-source.js';
import { PublicWebGuardRosterSource } from '../bilibili/public-web-guard-roster-source.js';
import { SnapshotService } from './snapshot-service.js';

export interface SnapshotRuntime {
  readonly service: SnapshotService;
  readonly source: GuardRosterSource;
  close(): void;
  start(): Promise<void>;
  tick(): Promise<void>;
}

export function createSnapshotRuntime(input: {
  readonly clock: Clock;
  readonly config: AppConfig;
  readonly database: DatabaseService;
  readonly maxDurationMs?: number;
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
  );
  let interval: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await service.precreateRuns();
      await service.runDue();
    } finally {
      ticking = false;
    }
  };
  return {
    service,
    source,
    close() {
      if (interval) clearInterval(interval);
      interval = null;
    },
    async start() {
      if (interval) return;
      await input.storage.cleanupStaleTemporaryObjects(
        new Date(input.clock.now().getTime() - 60 * 60_000),
      );
      await service.recoverInterrupted();
      await service.precreateRuns();
      void tick().catch(() => undefined);
      interval = setInterval(() => void tick().catch(() => undefined), 30_000);
      interval.unref();
    },
    tick,
  };
}
