import { and, count, desc, eq, isNotNull } from 'drizzle-orm';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrders,
  shipments,
  snapshotAttempts,
  snapshotPages,
  snapshotRuns,
  verificationRooms,
} from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { BindingRuntime } from '../binding/binding-runtime.js';
import type { FulfillmentRuntime } from '../fulfillment/fulfillment-runtime.js';
import { trackingRefreshDueCondition } from '../fulfillment/tracking-refresh-policy.js';
import type { SnapshotRuntime } from '../snapshots/snapshot-runtime.js';

interface SystemStatusServiceOptions {
  readonly clock: Clock;
  readonly database: DatabaseService;
  readonly bindingRuntime: BindingRuntime;
  readonly fulfillmentRuntime: FulfillmentRuntime;
  readonly snapshotRuntime: SnapshotRuntime;
  readonly storage: StorageDriver;
  readonly version: string;
}

function countRecord(rows: readonly { readonly status: string; readonly value: number }[]) {
  return Object.fromEntries(rows.map((row) => [row.status, row.value]));
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
    const bindingRuntime = this.options.bindingRuntime.getStatus();
    const snapshotRuntime = this.options.snapshotRuntime.getStatus();
    const fulfillmentRuntime = this.options.fulfillmentRuntime.getStatus();
    if (checks.database === 'down') {
      return {
        checks,
        integrityWarnings: [],
        recentSnapshotFailures: [],
        rooms: [],
        runtimes: {
          binding: bindingRuntime,
          roster: snapshotRuntime,
          tracking: fulfillmentRuntime,
        },
        shipmentProgressCounts: {},
        snapshotRunCounts: {},
        status: 'degraded' as const,
        trackingDueCount: 0,
        trackingExceptionCount: 0,
        version: this.options.version,
      };
    }
    const now = this.options.clock.now();
    const [
      runCounts,
      shipmentProgressCounts,
      trackingDue,
      trackingExceptions,
      failures,
      rooms,
      pageRows,
    ] = await Promise.all([
      this.options.database.orm
        .select({ status: snapshotRuns.status, value: count() })
        .from(snapshotRuns)
        .groupBy(snapshotRuns.status),
      this.options.database.orm
        .select({ status: shipments.progress, value: count() })
        .from(shipments)
        .groupBy(shipments.progress),
      this.options.database.orm
        .select({ value: count() })
        .from(shipments)
        .innerJoin(giftOrders, eq(giftOrders.id, shipments.giftOrderId))
        .where(trackingRefreshDueCondition(now)),
      this.options.database.orm
        .select({ value: count() })
        .from(shipments)
        .innerJoin(giftOrders, eq(giftOrders.id, shipments.giftOrderId))
        .where(and(eq(giftOrders.status, 'SHIPPED'), isNotNull(shipments.exceptionMessage))),
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
        binding: bindingRuntime,
        roster: snapshotRuntime,
        tracking: fulfillmentRuntime,
      },
      shipmentProgressCounts: countRecord(shipmentProgressCounts),
      snapshotRunCounts: countRecord(runCounts),
      status:
        checks.schema === 'down' ||
        checks.storage === 'down' ||
        integrityWarnings.length > 0 ||
        [bindingRuntime, snapshotRuntime, fulfillmentRuntime].some(
          (runtime) => runtime.state !== 'RUNNING',
        ) ||
        rooms.some((room) => room.enabled && room.healthStatus === 'UNHEALTHY')
          ? ('degraded' as const)
          : rooms.every((room) => !room.enabled)
            ? ('needs_setup' as const)
            : ('ok' as const),
      trackingDueCount: trackingDue[0]?.value ?? 0,
      trackingExceptionCount: trackingExceptions[0]?.value ?? 0,
      version: this.options.version,
    };
  }
}
