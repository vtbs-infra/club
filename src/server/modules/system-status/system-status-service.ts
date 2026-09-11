import { count, desc, eq, isNotNull } from 'drizzle-orm';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  snapshotAttempts,
  snapshotPages,
  snapshotRuns,
  verificationRooms,
} from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { IdentityRuntime } from '../auth/identity-runtime.js';
import type { GiftMediaRuntime } from '../gifts/gift-media-runtime.js';
import type { SnapshotRuntime } from '../snapshots/snapshot-runtime.js';

interface SystemStatusServiceOptions {
  readonly clock: Clock;
  readonly database: DatabaseService;
  readonly identityRuntime: IdentityRuntime;
  readonly giftMediaRuntime: GiftMediaRuntime;
  readonly snapshotRuntime: SnapshotRuntime;
  readonly storage: StorageDriver;
  readonly version: string;
}

export class SystemStatusService {
  public constructor(private readonly options: SystemStatusServiceOptions) {}

  public async platform() {
    const [databaseCheck, schemaCheck, storageCheck] = await Promise.allSettled([
      this.options.database.ping(),
      this.options.database.checkSchema(),
      this.options.storage.checkHealth(),
    ]);
    const checks = {
      database: databaseCheck.status === 'fulfilled' ? ('ok' as const) : ('down' as const),
      schema: schemaCheck.status === 'fulfilled' ? ('ok' as const) : ('down' as const),
      storage: storageCheck.status === 'fulfilled' ? ('ok' as const) : ('down' as const),
    };
    const identityRuntime = this.options.identityRuntime.getStatus();
    const snapshotRuntime = this.options.snapshotRuntime.getStatus();
    const giftMediaRuntime = this.options.giftMediaRuntime.getStatus();
    if (checks.database === 'down') {
      return {
        checks,
        integrityWarnings: [],
        recentSnapshotFailures: [],
        rooms: [],
        runtimes: {
          identity: identityRuntime,
          media: giftMediaRuntime,
          roster: snapshotRuntime,
        },
        snapshotRunCounts: [],
        status: 'degraded' as const,
        version: this.options.version,
      };
    }
    const [runCounts, failures, rooms, pageRows] = await Promise.all([
      this.options.database.orm
        .select({ status: snapshotRuns.status, value: count() })
        .from(snapshotRuns)
        .groupBy(snapshotRuns.status),
      this.options.database.orm
        .select({
          createdAt: snapshotAttempts.createdAt,
          creatorId: snapshotRuns.creatorId,
          failureCode: snapshotAttempts.failureCode,
          runId: snapshotRuns.id,
        })
        .from(snapshotAttempts)
        .innerJoin(snapshotRuns, eq(snapshotRuns.id, snapshotAttempts.snapshotRunId))
        .where(isNotNull(snapshotAttempts.failureCode))
        .orderBy(desc(snapshotAttempts.createdAt))
        .limit(20),
      this.options.database.orm
        .select({
          displayName: verificationRooms.displayName,
          enabled: verificationRooms.enabled,
          healthStatus: verificationRooms.healthStatus,
          lastConnectedAt: verificationRooms.lastConnectedAt,
        })
        .from(verificationRooms)
        .orderBy(verificationRooms.priority),
      this.options.database.orm
        .select({
          creatorId: snapshotRuns.creatorId,
          objectKey: snapshotPages.objectKey,
          pageId: snapshotPages.id,
          runId: snapshotRuns.id,
        })
        .from(snapshotPages)
        .innerJoin(snapshotAttempts, eq(snapshotAttempts.id, snapshotPages.snapshotAttemptId))
        .innerJoin(snapshotRuns, eq(snapshotRuns.id, snapshotAttempts.snapshotRunId))
        .orderBy(desc(snapshotPages.createdAt))
        .limit(50),
    ]);
    const integrityWarnings = (
      await Promise.all(
        pageRows.map(async (page) => {
          try {
            const stream = await this.options.storage.open(page.objectKey);
            await stream.cancel();
            return null;
          } catch {
            return {
              creatorId: page.creatorId,
              pageId: page.pageId,
              runId: page.runId,
            };
          }
        }),
      )
    ).filter((warning) => warning !== null);
    return {
      checks,
      integrityWarnings,
      recentSnapshotFailures: failures,
      rooms,
      runtimes: {
        identity: identityRuntime,
        media: giftMediaRuntime,
        roster: snapshotRuntime,
      },
      snapshotRunCounts: runCounts,
      status:
        checks.schema === 'down' ||
        checks.storage === 'down' ||
        integrityWarnings.length > 0 ||
        [identityRuntime, giftMediaRuntime, snapshotRuntime].some(
          (runtime) => runtime.state !== 'RUNNING',
        ) ||
        rooms.some((room) => room.enabled && room.healthStatus === 'UNHEALTHY')
          ? ('degraded' as const)
          : rooms.every((room) => !room.enabled)
            ? ('needs_setup' as const)
            : ('ok' as const),
      version: this.options.version,
    };
  }
}
