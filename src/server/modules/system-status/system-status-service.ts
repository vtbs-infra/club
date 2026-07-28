import { desc, eq, isNotNull } from 'drizzle-orm';

import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  shipments,
  snapshotAttempts,
  snapshotPages,
  snapshotRuns,
  verificationRooms,
} from '../../infrastructure/db/schema.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { FulfillmentRuntime } from '../fulfillment/fulfillment-runtime.js';
import type { SnapshotRuntime } from '../snapshots/snapshot-runtime.js';

interface SystemStatusServiceOptions {
  readonly database: DatabaseService;
  readonly fulfillmentRuntime: FulfillmentRuntime;
  readonly snapshotRuntime: SnapshotRuntime;
  readonly storage: StorageDriver;
  readonly version: string;
}

function counts(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

export class SystemStatusService {
  public constructor(private readonly options: SystemStatusServiceOptions) {}

  public async platform() {
    const [databaseCheck, storageCheck] = await Promise.allSettled([
      this.options.database.ping(),
      this.options.storage.checkHealth(),
    ]);
    const checks = {
      database: databaseCheck.status === 'fulfilled' ? ('ok' as const) : ('down' as const),
      storage: storageCheck.status === 'fulfilled' ? ('ok' as const) : ('down' as const),
    };
    const snapshotRuntime = this.options.snapshotRuntime.getStatus();
    const fulfillmentRuntime = this.options.fulfillmentRuntime.getStatus();
    if (checks.database === 'down') {
      return {
        checks,
        integrityWarnings: [],
        recentSnapshotFailures: [],
        rooms: [],
        schedulers: {
          roster: snapshotRuntime,
          tracking: fulfillmentRuntime,
        },
        shipmentCounts: {},
        snapshotRunCounts: {},
        status: 'degraded' as const,
        trackingDueCount: 0,
        version: this.options.version,
      };
    }
    const [runRows, shipmentRows, failures, rooms, pageRows] = await Promise.all([
      this.options.database.orm.select({ status: snapshotRuns.status }).from(snapshotRuns),
      this.options.database.orm
        .select({ nextRefreshAt: shipments.nextTrackingRefreshAt, status: shipments.status })
        .from(shipments),
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
    const now = new Date();
    return {
      checks,
      integrityWarnings,
      recentSnapshotFailures: failures,
      rooms,
      schedulers: {
        roster: snapshotRuntime,
        tracking: fulfillmentRuntime,
      },
      shipmentCounts: counts(shipmentRows.map((shipment) => shipment.status)),
      snapshotRunCounts: counts(runRows.map((run) => run.status)),
      status:
        checks.storage === 'ok' && integrityWarnings.length === 0
          ? ('ok' as const)
          : ('degraded' as const),
      trackingDueCount: shipmentRows.filter(
        (shipment) =>
          shipment.nextRefreshAt !== null &&
          shipment.nextRefreshAt <= now &&
          shipment.status !== 'DELIVERED',
      ).length,
      version: this.options.version,
    };
  }
}
