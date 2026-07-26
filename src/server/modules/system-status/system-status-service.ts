import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

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

interface IntegrityCandidate {
  readonly creatorId: string;
  readonly objectKey: string;
  readonly organizationId: string;
  readonly pageId: string;
  readonly runId: string;
}

function timestamp(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function counts(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

export class SystemStatusService {
  public constructor(private readonly options: SystemStatusServiceOptions) {}

  private snapshotScope(organizationId?: string, creatorIds: readonly string[] = []) {
    if (!organizationId) return undefined;
    return creatorIds.length
      ? and(
          eq(snapshotRuns.organizationId, organizationId),
          inArray(snapshotRuns.creatorId, [...creatorIds]),
        )
      : eq(snapshotRuns.organizationId, organizationId);
  }

  private shipmentScope(organizationId?: string, creatorIds: readonly string[] = []) {
    if (!organizationId) return undefined;
    return creatorIds.length
      ? and(
          eq(shipments.organizationId, organizationId),
          inArray(shipments.creatorId, [...creatorIds]),
        )
      : eq(shipments.organizationId, organizationId);
  }

  private async dependencyChecks() {
    const [database, storage] = await Promise.allSettled([
      this.options.database.ping(),
      this.options.storage.checkHealth(),
    ]);
    return {
      database: database.status === 'fulfilled' ? ('ok' as const) : ('down' as const),
      storage: storage.status === 'fulfilled' ? ('ok' as const) : ('down' as const),
    };
  }

  private async integrityCandidates(
    organizationId?: string,
    creatorIds: readonly string[] = [],
  ): Promise<IntegrityCandidate[]> {
    return this.options.database.orm
      .select({
        creatorId: snapshotRuns.creatorId,
        objectKey: snapshotPages.objectKey,
        organizationId: snapshotRuns.organizationId,
        pageId: snapshotPages.id,
        runId: snapshotRuns.id,
      })
      .from(snapshotPages)
      .innerJoin(snapshotAttempts, eq(snapshotAttempts.id, snapshotPages.snapshotAttemptId))
      .innerJoin(snapshotRuns, eq(snapshotRuns.id, snapshotAttempts.snapshotRunId))
      .where(this.snapshotScope(organizationId, creatorIds))
      .orderBy(desc(snapshotPages.createdAt))
      .limit(50);
  }

  private async missingObjects(organizationId?: string, creatorIds: readonly string[] = []) {
    const candidates = await this.integrityCandidates(organizationId, creatorIds);
    const checked = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const stream = await this.options.storage.open(candidate.objectKey);
          await stream.cancel();
          return null;
        } catch {
          return {
            creatorId: candidate.creatorId,
            organizationId: candidate.organizationId,
            pageId: candidate.pageId,
            runId: candidate.runId,
          };
        }
      }),
    );
    return checked.filter((item) => item !== null);
  }

  private schedulerStatus() {
    const snapshot = this.options.snapshotRuntime.getStatus();
    const fulfillment = this.options.fulfillmentRuntime.getStatus();
    return {
      snapshot: {
        lastTickAt: timestamp(snapshot.lastTickAt),
        running: snapshot.running,
      },
      tracking: {
        configured: fulfillment.configured,
        lastTickAt: timestamp(fulfillment.lastTickAt),
        running: fulfillment.running,
      },
    };
  }

  private async diagnostics(organizationId?: string, creatorIds: readonly string[] = []) {
    const whereOrganization = this.snapshotScope(organizationId, creatorIds);
    const shipmentWhere = this.shipmentScope(organizationId, creatorIds);
    const [runs, failedAttempts, shipmentRows, roomRows, missing] = await Promise.all([
      this.options.database.orm
        .select({ status: snapshotRuns.status })
        .from(snapshotRuns)
        .where(whereOrganization),
      this.options.database.orm
        .select({
          createdAt: snapshotAttempts.createdAt,
          creatorId: snapshotRuns.creatorId,
          failureCode: snapshotAttempts.failureCode,
          runId: snapshotRuns.id,
        })
        .from(snapshotAttempts)
        .innerJoin(snapshotRuns, eq(snapshotRuns.id, snapshotAttempts.snapshotRunId))
        .where(
          organizationId
            ? and(whereOrganization, isNotNull(snapshotAttempts.failureCode))
            : isNotNull(snapshotAttempts.failureCode),
        )
        .orderBy(desc(snapshotAttempts.createdAt))
        .limit(20),
      this.options.database.orm
        .select({
          nextRefreshAt: shipments.nextTrackingRefreshAt,
          status: shipments.status,
        })
        .from(shipments)
        .where(shipmentWhere),
      this.options.database.orm
        .select({
          displayName: verificationRooms.displayName,
          enabled: verificationRooms.enabled,
          healthStatus: verificationRooms.healthStatus,
          lastConnectedAt: verificationRooms.lastConnectedAt,
        })
        .from(verificationRooms)
        .orderBy(verificationRooms.priority),
      this.missingObjects(organizationId, creatorIds),
    ]);
    const failures = failedAttempts
      .filter((attempt) => attempt.failureCode !== null)
      .map((attempt) => ({
        createdAt: attempt.createdAt.toISOString(),
        creatorId: attempt.creatorId,
        failureCode: attempt.failureCode,
        runId: attempt.runId,
      }));
    const now = new Date();
    return {
      failures,
      integrity: missing,
      rooms: roomRows,
      runCounts: counts(runs.map((run) => run.status)),
      shipmentCounts: counts(shipmentRows.map((shipment) => shipment.status)),
      trackingDueCount: shipmentRows.filter(
        (shipment) =>
          shipment.nextRefreshAt !== null &&
          shipment.nextRefreshAt <= now &&
          shipment.status !== 'DELIVERED',
      ).length,
    };
  }

  public async platform() {
    const checks = await this.dependencyChecks();
    if (checks.database === 'down') {
      return {
        checks,
        integrityWarnings: [],
        recentSnapshotFailures: [],
        rooms: [],
        schedulers: this.schedulerStatus(),
        snapshotRunCounts: {},
        status: 'degraded' as const,
        tracking: { dueCount: 0, shipmentCounts: {} },
        version: this.options.version,
      };
    }
    const diagnostics = await this.diagnostics();
    return {
      checks,
      integrityWarnings: diagnostics.integrity,
      recentSnapshotFailures: diagnostics.failures,
      rooms: diagnostics.rooms.map((room) => ({
        displayName: room.displayName,
        enabled: room.enabled,
        healthStatus: room.healthStatus,
        lastConnectedAt: timestamp(room.lastConnectedAt),
      })),
      schedulers: this.schedulerStatus(),
      snapshotRunCounts: diagnostics.runCounts,
      status:
        checks.storage === 'ok' && diagnostics.integrity.length === 0
          ? ('ok' as const)
          : ('degraded' as const),
      tracking: {
        dueCount: diagnostics.trackingDueCount,
        shipmentCounts: diagnostics.shipmentCounts,
      },
      version: this.options.version,
    };
  }

  public async organization(organizationId: string, creatorIds: readonly string[] = []) {
    const checks = await this.dependencyChecks();
    if (checks.database === 'down') {
      return {
        checks,
        integrityWarningCount: 0,
        recentSnapshotFailures: [],
        roomHealthCounts: {},
        schedulers: this.schedulerStatus(),
        snapshotRunCounts: {},
        status: 'degraded' as const,
        tracking: { dueCount: 0, exceptionCount: 0 },
        version: this.options.version,
      };
    }
    const diagnostics = await this.diagnostics(organizationId, creatorIds);
    return {
      checks,
      integrityWarningCount: diagnostics.integrity.length,
      recentSnapshotFailures: diagnostics.failures,
      roomHealthCounts: counts(
        diagnostics.rooms.filter((room) => room.enabled).map((room) => room.healthStatus),
      ),
      schedulers: this.schedulerStatus(),
      snapshotRunCounts: diagnostics.runCounts,
      status:
        checks.storage === 'ok' && diagnostics.integrity.length === 0
          ? ('ok' as const)
          : ('degraded' as const),
      tracking: {
        dueCount: diagnostics.trackingDueCount,
        exceptionCount: diagnostics.shipmentCounts.EXCEPTION ?? 0,
      },
      version: this.options.version,
    };
  }
}
