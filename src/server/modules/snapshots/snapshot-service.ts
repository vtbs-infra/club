import { CaptureFailure } from './roster-consistency.js';
import { collectRoster } from './roster-capture.js';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import { SNAPSHOT_ATTEMPT_LIMIT } from '../../../shared/contracts/snapshots.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { databaseWriteBatches } from '../../infrastructure/db/write-batches.js';
import {
  creators,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotPages,
  snapshotRuns,
} from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import { AuditService } from '../audit/audit-service.js';
import type { RequestAuditContext } from '../audit/audit-service.js';
import { type GuardRosterPage, type GuardRosterSource } from '../bilibili/guard-roster-source.js';
import {
  calculateMonthlyCutoff,
  classifyPunctuality,
  relevantMonthlyPeriods,
} from './month-end.js';
import type { GiftEligibilityService } from '../gifts/eligibility-service.js';
import { lockEligibilityPeriod } from '../gifts/eligibility-lock.js';
import { SnapshotQueryService } from './snapshot-query-service.js';

const gzipAsync = promisify(gzip);
const SCHEDULER_CONCURRENCY = 4;

interface CaptureRun {
  readonly creatorBilibiliUid: string;
  readonly creatorId: string;
  readonly creatorRoomId: string;
  readonly id: string;
  readonly onTimeWindowEndAt: Date;
  readonly scheduledCutoffAt: Date;
}

interface AttemptRequest {
  readonly context?: RequestAuditContext;
  readonly initiatedBy: 'ADMIN' | 'SCHEDULER';
}

function failure(error: unknown): CaptureFailure {
  if (error instanceof CaptureFailure) return error;
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new CaptureFailure('CAPTURE_TIMEOUT', 'The roster capture exceeded its time limit.');
  }
  const message = error instanceof Error ? error.message : 'Roster capture failed.';
  return new CaptureFailure('SOURCE_FAILURE', message.slice(0, 500));
}

export class SnapshotService {
  private readonly activeCaptures = new Map<
    string,
    { readonly controller: AbortController; readonly execution: Promise<void> }
  >();
  private readonly audit: AuditService;
  private shuttingDown = false;
  public readonly queries: SnapshotQueryService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageDriver,
    private readonly source: GuardRosterSource,
    private readonly clock: Clock,
    private readonly eligibility: GiftEligibilityService,
    private readonly maxDurationMs = 120_000,
    private readonly onBackgroundError?: (error: unknown) => void,
  ) {
    this.audit = new AuditService(database);
    this.queries = new SnapshotQueryService(database, storage, clock);
  }

  public async precreateRuns(): Promise<number> {
    const enabled = await this.database.orm
      .select()
      .from(creators)
      .where(eq(creators.monthlySyncEnabled, true));
    let created = 0;
    for (const row of enabled) {
      for (const periodStart of relevantMonthlyPeriods(this.clock.now(), row.timezone)) {
        const cutoff = calculateMonthlyCutoff(periodStart, row.timezone);
        const inserted = await this.database.orm
          .insert(snapshotRuns)
          .values({
            creatorBilibiliUid: row.bilibiliUid,
            creatorId: row.id,
            creatorRoomId: row.roomId,
            cutoffTimezone: cutoff.cutoffTimezone,
            onTimeWindowEndAt: cutoff.onTimeWindowEndAt,
            periodStart: cutoff.periodStart,
            scheduledCutoffAt: cutoff.scheduledCutoffAt,
          })
          .onConflictDoNothing()
          .returning({ id: snapshotRuns.id });
        created += inserted.length;
      }
    }
    return created;
  }

  public async recoverInterrupted(): Promise<number> {
    const running = await this.database.orm
      .select({ id: snapshotRuns.id })
      .from(snapshotRuns)
      .where(eq(snapshotRuns.status, 'RUNNING'));
    let recovered = 0;
    for (const candidate of running) {
      if (this.activeCaptures.has(candidate.id)) continue;
      await this.database.orm.transaction(async (transaction) => {
        const [run] = await transaction
          .select()
          .from(snapshotRuns)
          .where(eq(snapshotRuns.id, candidate.id))
          .for('update');
        // Ownership includes the transaction that starts an attempt, so recovery cannot
        // mistake a newly committed RUNNING row for abandoned work.
        if (!run || run.status !== 'RUNNING' || this.activeCaptures.has(run.id)) return;
        await transaction
          .update(snapshotAttempts)
          .set({
            captureCompletedAt: this.clock.now(),
            consistencyStatus: 'INCONSISTENT',
            failureCode: 'PROCESS_INTERRUPTED',
            failureMessage: 'Capture execution ended before its result was durably recorded.',
          })
          .where(
            and(
              eq(snapshotAttempts.snapshotRunId, run.id),
              isNull(snapshotAttempts.captureCompletedAt),
            ),
          );
        await transaction
          .update(snapshotRuns)
          .set({ status: 'FAILED', updatedAt: this.clock.now() })
          .where(eq(snapshotRuns.id, run.id));
        recovered += 1;
      });
    }
    return recovered;
  }

  public async runDue(): Promise<number> {
    if (this.shuttingDown) return 0;
    await this.recoverInterrupted();
    const due = await this.database.orm
      .select({ id: snapshotRuns.id, status: snapshotRuns.status })
      .from(snapshotRuns)
      .innerJoin(creators, eq(creators.id, snapshotRuns.creatorId))
      .where(
        or(
          eq(snapshotRuns.status, 'READY'),
          and(
            eq(snapshotRuns.status, 'SCHEDULED'),
            lte(snapshotRuns.scheduledCutoffAt, this.clock.now()),
            eq(creators.monthlySyncEnabled, true),
          ),
        ),
      )
      .orderBy(asc(snapshotRuns.scheduledCutoffAt));
    let nextIndex = 0;
    let started = 0;
    const unexpectedErrors: unknown[] = [];
    const workers = Array.from(
      { length: Math.min(SCHEDULER_CONCURRENCY, due.length) },
      async () => {
        while (nextIndex < due.length) {
          const run = due[nextIndex];
          nextIndex += 1;
          if (!run) continue;
          try {
            if (run.status === 'READY') await this.finalizeReady(run.id);
            else await this.capture(run.id);
            started += 1;
          } catch (error) {
            if (!(error instanceof AppError)) unexpectedErrors.push(error);
          }
        }
      },
    );
    await Promise.all(workers);
    if (unexpectedErrors.length > 0) {
      throw new AggregateError(unexpectedErrors, 'One or more snapshot tasks could not start.');
    }
    return started;
  }

  private async beginAttempt(
    runId: string,
    request: AttemptRequest,
  ): Promise<{ attemptId: string; run: CaptureRun }> {
    if (this.shuttingDown) {
      throw new AppError(
        'SNAPSHOT_RUNTIME_STOPPING',
        'Snapshot captures cannot start while the application is shutting down.',
        503,
      );
    }
    return this.database.orm.transaction(async (transaction) => {
      const [selection] = await transaction
        .select({ monthlySyncEnabled: creators.monthlySyncEnabled, run: snapshotRuns })
        .from(snapshotRuns)
        .innerJoin(creators, eq(creators.id, snapshotRuns.creatorId))
        .where(eq(snapshotRuns.id, runId))
        .limit(1)
        .for('update');
      const run = selection?.run;
      if (!run) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot run not found.', 404);
      if (!selection.monthlySyncEnabled) {
        throw new AppError(
          'SNAPSHOT_MONTHLY_SYNC_DISABLED',
          'A creator with monthly synchronization disabled cannot start a snapshot capture.',
          409,
        );
      }
      const allowedStatuses =
        request.initiatedBy === 'SCHEDULER' ? ['SCHEDULED'] : ['FAILED', 'REJECTED'];
      if (!allowedStatuses.includes(run.status)) {
        throw new AppError('SNAPSHOT_CAPTURE_NOT_ALLOWED', 'This snapshot cannot be retried.', 409);
      }
      if (run.scheduledCutoffAt > this.clock.now()) {
        throw new AppError('SNAPSHOT_NOT_DUE', 'The snapshot cutoff has not arrived.', 409);
      }
      const [latest] = await transaction
        .select({ attemptNumber: snapshotAttempts.attemptNumber })
        .from(snapshotAttempts)
        .where(eq(snapshotAttempts.snapshotRunId, run.id))
        .orderBy(desc(snapshotAttempts.attemptNumber))
        .limit(1);
      if ((latest?.attemptNumber ?? 0) >= SNAPSHOT_ATTEMPT_LIMIT) {
        throw new AppError(
          'SNAPSHOT_ATTEMPT_LIMIT_REACHED',
          'This snapshot has reached its capture attempt limit.',
          409,
        );
      }
      const [attempt] = await transaction
        .insert(snapshotAttempts)
        .values({
          attemptNumber: (latest?.attemptNumber ?? 0) + 1,
          initiatedBy: request.initiatedBy,
          requestedByUserId: request.context?.actorUserId ?? null,
          schedulerStartedAt: this.clock.now(),
          snapshotRunId: run.id,
          sourceName: this.source.name,
          sourceVersion: this.source.version,
        })
        .returning({ id: snapshotAttempts.id });
      if (!attempt) throw new Error('Snapshot attempt insert returned no row.');
      await transaction
        .update(snapshotRuns)
        .set({ status: 'RUNNING', updatedAt: this.clock.now() })
        .where(eq(snapshotRuns.id, run.id));
      if (request.context) {
        await this.audit.record(
          {
            action: 'snapshot.retry-started',
            actorUserId: request.context.actorUserId,
            afterSummary: {
              attemptId: attempt.id,
              attemptNumber: (latest?.attemptNumber ?? 0) + 1,
            },
            creatorId: run.creatorId,
            ipAddress: request.context.ipAddress,
            requestId: request.context.requestId,
            targetId: run.id,
            targetType: 'snapshot-run',
          },
          transaction,
        );
      }
      return { attemptId: attempt.id, run };
    });
  }

  private async persistPage(
    runId: string,
    attemptId: string,
    page: GuardRosterPage,
    captureKind: 'PAGE' | 'RECHECK',
  ): Promise<void> {
    const hash = createHash('sha256').update(page.rawBytes).digest('hex');
    const compressed = await gzipAsync(page.rawBytes);
    const suffix = captureKind === 'PAGE' ? `page-${page.pageNumber}` : 'page-1-recheck';
    const objectKey = `private/snapshots/${runId}/${attemptId}/${suffix}.json.gz`;
    await this.storage.put({ data: compressed, key: objectKey });
    try {
      await this.database.orm.insert(snapshotPages).values({
        captureKind,
        compressedSize: compressed.length,
        contentHashSha256: hash,
        declaredPageCount: page.declaredPageCount,
        declaredTotal: page.declaredTotal,
        fetchedAt: page.fetchedAt,
        itemCount: page.members.length,
        objectKey,
        pageNumber: page.pageNumber,
        snapshotAttemptId: attemptId,
        uncompressedSize: page.rawBytes.length,
      });
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  private async executeCapture(
    attemptId: string,
    run: CaptureRun,
    shutdownSignal: AbortSignal,
  ): Promise<void> {
    const captureStartedAt = this.clock.now();
    const punctuality = classifyPunctuality(
      captureStartedAt,
      run.scheduledCutoffAt,
      run.onTimeWindowEndAt,
    );
    const signal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(this.maxDurationMs)]);
    try {
      signal.throwIfAborted();
      await this.database.orm
        .update(snapshotAttempts)
        .set({ captureStartedAt, punctuality })
        .where(eq(snapshotAttempts.id, attemptId));
      const { declaredTotal, members } = await collectRoster({
        source: this.source,
        creatorUid: run.creatorBilibiliUid,
        roomId: run.creatorRoomId,
        signal,
        persistPage: (page, kind) => this.persistPage(run.id, attemptId, page, kind),
      });
      signal.throwIfAborted();
      const completedAt = this.clock.now();
      await this.database.orm.transaction(async (transaction) => {
        if (members.length > 0) {
          const rows = members.map((member) => ({
            biliUid: member.biliUid,
            displayNameAtCapture: member.displayName,
            rawTier: member.rawTier,
            snapshotAttemptId: attemptId,
            sourcePage: member.sourcePage,
            sourcePosition: member.sourcePosition,
            tier: member.tier,
          }));
          for (const batch of databaseWriteBatches(rows)) {
            await transaction.insert(snapshotAttemptMembers).values(batch);
          }
        }
        await transaction
          .update(snapshotAttempts)
          .set({
            captureCompletedAt: completedAt,
            consistencyStatus: 'CONSISTENT',
            declaredTotal,
            normalizedTotal: members.length,
          })
          .where(eq(snapshotAttempts.id, attemptId));
        await transaction
          .update(snapshotRuns)
          .set({
            status: punctuality === 'ON_TIME' ? 'READY' : 'PENDING_APPROVAL',
            updatedAt: completedAt,
          })
          .where(eq(snapshotRuns.id, run.id));
      });
    } catch (error) {
      const captureFailure = failure(signal.aborted ? signal.reason : error);
      await this.database.orm.transaction(async (transaction) => {
        const [current] = await transaction
          .select({ status: snapshotRuns.status })
          .from(snapshotRuns)
          .where(eq(snapshotRuns.id, run.id))
          .for('update');
        // A commit may have succeeded even if its acknowledgement was lost.
        // Never overwrite an already sealed capture with failure recovery.
        if (current?.status !== 'RUNNING') return;
        await transaction
          .update(snapshotAttempts)
          .set({
            captureCompletedAt: this.clock.now(),
            consistencyStatus: 'INCONSISTENT',
            failureCode: captureFailure.code,
            failureMessage: captureFailure.message,
          })
          .where(eq(snapshotAttempts.id, attemptId));
        await transaction
          .update(snapshotRuns)
          .set({ status: 'FAILED', updatedAt: this.clock.now() })
          .where(eq(snapshotRuns.id, run.id));
      });
      return;
    }
    // Capture is durable. A business failure leaves READY for retry without another fetch.
    if (punctuality === 'ON_TIME') await this.finalizeReady(run.id);
  }

  private startExecution(runId: string, request: AttemptRequest) {
    if (this.activeCaptures.has(runId)) {
      throw new AppError(
        'SNAPSHOT_CAPTURE_NOT_ALLOWED',
        'This snapshot is already executing.',
        409,
      );
    }
    const controller = new AbortController();
    if (this.shuttingDown) controller.abort(shutdownFailure());
    const started = Promise.withResolvers<{ attemptId: string }>();
    const execution = Promise.resolve().then(async () => {
      try {
        const { attemptId, run } = await this.beginAttempt(runId, request);
        started.resolve({ attemptId });
        await this.executeCapture(attemptId, run, controller.signal);
      } catch (error) {
        started.reject(error);
        throw error;
      }
    });
    const active = { controller, execution };
    this.activeCaptures.set(runId, active);
    const remove = () => {
      if (this.activeCaptures.get(runId) === active) this.activeCaptures.delete(runId);
    };
    void execution.then(remove, remove);
    return { execution, started: started.promise };
  }

  public async capture(runId: string): Promise<void> {
    const { started, execution } = this.startExecution(runId, { initiatedBy: 'SCHEDULER' });
    await started;
    await execution;
  }

  public async queueCapture(
    runId: string,
    context: RequestAuditContext,
  ): Promise<{ attemptId: string }> {
    const { started, execution } = this.startExecution(runId, {
      context,
      initiatedBy: 'ADMIN',
    });
    const result = await started;
    void execution.catch((error: unknown) => this.onBackgroundError?.(error));
    return result;
  }

  public beginShutdown(): void {
    this.shuttingDown = true;
    for (const { controller } of this.activeCaptures.values()) {
      if (!controller.signal.aborted) controller.abort(shutdownFailure());
    }
  }

  public async waitForIdle(): Promise<void> {
    while (this.activeCaptures.size > 0) {
      await Promise.allSettled([...this.activeCaptures.values()].map(({ execution }) => execution));
    }
  }

  public async finalizeReady(runId: string): Promise<void> {
    await this.finalize(runId, null);
  }

  public async approveLate(
    runId: string,
    expectedAttemptId: string,
    context: RequestAuditContext,
  ): Promise<void> {
    await this.finalize(runId, { ...context, expectedAttemptId });
  }

  private async finalize(
    runId: string,
    context: (RequestAuditContext & { expectedAttemptId: string }) | null,
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const [scope] = await transaction
        .select()
        .from(snapshotRuns)
        .where(eq(snapshotRuns.id, runId));
      if (!scope) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot run not found.', 404);
      await lockEligibilityPeriod(transaction, scope.creatorId, scope.periodStart);
      const [run] = await transaction
        .select()
        .from(snapshotRuns)
        .where(eq(snapshotRuns.id, runId))
        .for('update');
      if (!run) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot run not found.', 404);
      if (run.status === 'FINALIZED') {
        if (context && run.acceptedAttemptId !== context.expectedAttemptId) {
          throw new AppError(
            'SNAPSHOT_ATTEMPT_CONFLICT',
            'The reviewed capture is no longer current. Reload and review it again.',
            409,
          );
        }
        return;
      }
      const expectedStatus = context ? 'PENDING_APPROVAL' : 'READY';
      if (run.status !== expectedStatus) {
        throw new AppError(
          'SNAPSHOT_NOT_APPROVABLE',
          'No consistent attempt is awaiting finalization.',
          409,
        );
      }
      const [attempt] = await transaction
        .select()
        .from(snapshotAttempts)
        .where(
          and(
            eq(snapshotAttempts.snapshotRunId, run.id),
            eq(snapshotAttempts.consistencyStatus, 'CONSISTENT'),
            eq(snapshotAttempts.punctuality, context ? 'LATE' : 'ON_TIME'),
          ),
        )
        .orderBy(desc(snapshotAttempts.attemptNumber))
        .limit(1);
      if (!attempt?.captureCompletedAt)
        throw new Error('A ready snapshot requires a completed consistent attempt.');
      if (context && attempt.id !== context.expectedAttemptId) {
        throw new AppError(
          'SNAPSHOT_ATTEMPT_CONFLICT',
          'The reviewed capture is no longer current. Reload and review it again.',
          409,
        );
      }
      const now = this.clock.now();
      await transaction
        .update(snapshotRuns)
        .set({
          acceptedAttemptId: attempt.id,
          approvedAt: context ? now : null,
          approvedBy: context?.actorUserId ?? null,
          finalizedAt: now,
          status: 'FINALIZED',
          updatedAt: now,
        })
        .where(eq(snapshotRuns.id, run.id));
      const createdOrders = await this.eligibility.reconcileSnapshot(run.id, transaction);
      await this.audit.record(
        {
          action: context ? 'snapshot.late-approved' : 'snapshot.finalized',
          actorUserId: context?.actorUserId ?? null,
          afterSummary: {
            attemptId: attempt.id,
            memberCount: attempt.normalizedTotal,
            createdOrders,
          },
          creatorId: run.creatorId,
          ...(context ? { ipAddress: context.ipAddress, requestId: context.requestId } : {}),
          targetId: run.id,
          targetType: 'snapshot-run',
        },
        transaction,
      );
    });
  }

  public async rejectLate(
    runId: string,
    expectedAttemptId: string,
    context: RequestAuditContext & { reason: string },
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(snapshotRuns)
        .where(and(eq(snapshotRuns.id, runId), eq(snapshotRuns.status, 'PENDING_APPROVAL')))
        .for('update');
      if (!run) throw new AppError('SNAPSHOT_NOT_REJECTABLE', 'No late attempt is pending.', 409);
      const [attempt] = await transaction
        .select({ id: snapshotAttempts.id })
        .from(snapshotAttempts)
        .where(eq(snapshotAttempts.snapshotRunId, runId))
        .orderBy(desc(snapshotAttempts.attemptNumber))
        .limit(1);
      if (attempt?.id !== expectedAttemptId) {
        throw new AppError(
          'SNAPSHOT_ATTEMPT_CONFLICT',
          'The reviewed capture is no longer current. Reload and review it again.',
          409,
        );
      }
      const [updated] = await transaction
        .update(snapshotRuns)
        .set({ status: 'REJECTED', updatedAt: this.clock.now() })
        .where(eq(snapshotRuns.id, runId))
        .returning();
      await this.audit.record(
        {
          action: 'snapshot.late-rejected',
          afterSummary: { attemptId: expectedAttemptId },
          actorUserId: context.actorUserId,
          creatorId: run.creatorId,
          ipAddress: context.ipAddress,
          reason: context.reason,
          requestId: context.requestId,
          targetId: run.id,
          targetType: 'snapshot-run',
        },
        transaction,
      );
      return updated!;
    });
  }
}

function shutdownFailure(): CaptureFailure {
  return new CaptureFailure(
    'PROCESS_SHUTDOWN',
    'The application is shutting down before this attempt completed.',
  );
}
