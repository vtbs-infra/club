import type { Clock } from '../../infrastructure/clock/clock.js';
import {
  createPeriodicRuntime,
  type PeriodicRuntime,
} from '../../infrastructure/runtime/periodic-runtime.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { SnapshotService } from './snapshot-service.js';

export type SnapshotRuntime = PeriodicRuntime;

export function createSnapshotRuntime(input: {
  readonly clock: Clock;
  readonly service: Pick<
    SnapshotService,
    'precreateRuns' | 'runDue' | 'beginShutdown' | 'waitForIdle'
  >;
  readonly reportError?: (error: unknown, operation: string) => void;
  readonly storage: Pick<StorageDriver, 'cleanupStaleTemporaryObjects'>;
}): SnapshotRuntime {
  const runtime = createPeriodicRuntime({
    clock: input.clock,
    name: 'snapshot',
    intervalMs: 30_000,
    async initialize() {
      await input.storage.cleanupStaleTemporaryObjects(
        new Date(input.clock.now().getTime() - 60 * 60_000),
      );
    },
    async run() {
      await input.service.precreateRuns();
      await input.service.runDue();
    },
    ...(input.reportError ? { reportError: input.reportError } : {}),
  });
  return {
    ...runtime,
    async close() {
      input.service.beginShutdown();
      await runtime.close();
      await input.service.waitForIdle();
    },
  };
}
