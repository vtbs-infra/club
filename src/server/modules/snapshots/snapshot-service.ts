import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  creators,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
} from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import { AuditService } from '../audit/audit-service.js';
import type { RequestAuditContext } from '../audit/audit-service.js';
import type {
  GuardRosterMember,
  GuardRosterPage,
  GuardRosterSource,
} from '../bilibili/guard-roster-source.js';
import {
  calculateMonthlyCutoff,
  classifyPunctuality,
  relevantMonthlyPeriods,
} from './month-end.js';
import { SnapshotQueryService } from './snapshot-query-service.js';

const gzipAsync = promisify(gzip);
const PAGE_SIZE = 30;
const MAX_PAGES = 1_000;
const MAX_ATTEMPTS = 3;
const SCHEDULER_CONCURRENCY = 4;

class CaptureFailure extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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

function fingerprint(page: GuardRosterPage): string {
  return page.members
    .map((member) => `${member.biliUid}:${member.rawTier}:${member.sourcePosition}`)
    .join('|');
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
  private readonly backgroundCaptures = new Set<Promise<void>>();
  private readonly audit: AuditService;
  public readonly queries: SnapshotQueryService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageDriver,
    private readonly source: GuardRosterSource,
    private readonly clock: Clock,
    private readonly maxDurationMs = 120_000,
    private readonly onFinalized?: (runId: string, executor: AppDatabase) => Promise<unknown>,
    private readonly onBackgroundError?: (error: unknown) => void,
  ) {
    this.audit = new AuditService(database);
    this.queries = new SnapshotQueryService(database, storage);
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
    for (const run of running) {
      await this.database.orm.transaction(async (transaction) => {
        await transaction
          .update(snapshotAttempts)
          .set({
            captureCompletedAt: this.clock.now(),
            consistencyStatus: 'INCONSISTENT',
            failureCode: 'PROCESS_INTERRUPTED',
            failureMessage: 'The application stopped before this attempt completed.',
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
      });
    }
    return running.length;
  }

  public async runDue(): Promise<number> {
    const due = await this.database.orm
      .select({ id: snapshotRuns.id })
      .from(snapshotRuns)
      .innerJoin(creators, eq(creators.id, snapshotRuns.creatorId))
      .where(
        and(
          inArray(snapshotRuns.status, ['SCHEDULED', 'FAILED']),
          lte(snapshotRuns.scheduledCutoffAt, this.clock.now()),
          eq(creators.monthlySyncEnabled, true),
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
            await this.capture(run.id);
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
      if (!['SCHEDULED', 'FAILED', 'REJECTED'].includes(run.status)) {
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
      if ((latest?.attemptNumber ?? 0) >= MAX_ATTEMPTS) {
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

  private validatePages(pages: readonly GuardRosterPage[], recheck: GuardRosterPage) {
    const first = pages[0];
    if (!first) throw new CaptureFailure('MISSING_PAGE', 'The first roster page is missing.');
    if (first.declaredPageCount > MAX_PAGES) {
      throw new CaptureFailure('PAGE_LIMIT_EXCEEDED', 'The provider declared too many pages.');
    }
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]!;
      if (page.pageNumber !== index + 1) {
        throw new CaptureFailure('MISSING_PAGE', 'A roster page was missing or out of order.');
      }
      if (
        page.declaredPageCount !== first.declaredPageCount ||
        page.declaredTotal !== first.declaredTotal
      ) {
        throw new CaptureFailure('COUNT_DRIFT', 'Roster totals changed during pagination.');
      }
    }
    if (
      recheck.declaredPageCount !== first.declaredPageCount ||
      recheck.declaredTotal !== first.declaredTotal ||
      fingerprint(recheck) !== fingerprint(first)
    ) {
      throw new CaptureFailure('FIRST_PAGE_DRIFT', 'The first roster page changed during capture.');
    }
    const members = pages.flatMap((page) => [...page.members]);
    if (members.some((member) => member.tier === null)) {
      throw new CaptureFailure('UNKNOWN_TIER', 'The provider returned an unknown guard tier.');
    }
    if (new Set(members.map((member) => member.biliUid)).size !== members.length) {
      throw new CaptureFailure('DUPLICATE_UID', 'The roster contained a duplicate UID.');
    }
    if (members.length !== first.declaredTotal) {
      throw new CaptureFailure('COUNT_MISMATCH', 'The normalized roster did not match its total.');
    }
    return members as readonly (GuardRosterMember & {
      tier: NonNullable<GuardRosterMember['tier']>;
    })[];
  }

  private async executeCapture(attemptId: string, run: CaptureRun): Promise<void> {
    const captureStartedAt = this.clock.now();
    const punctuality = classifyPunctuality(
      captureStartedAt,
      run.scheduledCutoffAt,
      run.onTimeWindowEndAt,
    );
    await this.database.orm
      .update(snapshotAttempts)
      .set({ captureStartedAt, punctuality })
      .where(eq(snapshotAttempts.id, attemptId));
    const signal = AbortSignal.timeout(this.maxDurationMs);
    try {
      const fetch = (pageNumber: number) =>
        this.source.fetchPage({
          creatorUid: run.creatorBilibiliUid,
          pageNumber,
          pageSize: PAGE_SIZE,
          roomId: run.creatorRoomId,
          signal,
        });
      const first = await fetch(1);
      if (first.pageNumber !== 1 || first.declaredPageCount < 1) {
        throw new CaptureFailure('INVALID_FIRST_PAGE', 'The provider returned invalid pagination.');
      }
      await this.persistPage(run.id, attemptId, first, 'PAGE');
      const pages: GuardRosterPage[] = [first];
      for (let start = 2; start <= first.declaredPageCount; start += 4) {
        const numbers = Array.from(
          { length: Math.min(4, first.declaredPageCount - start + 1) },
          (_, offset) => start + offset,
        );
        const chunk = await Promise.all(numbers.map(fetch));
        for (const page of chunk) await this.persistPage(run.id, attemptId, page, 'PAGE');
        pages.push(...chunk);
      }
      const recheck = await fetch(1);
      await this.persistPage(run.id, attemptId, recheck, 'RECHECK');
      const members = this.validatePages(pages, recheck);
      const completedAt = this.clock.now();
      await this.database.orm.transaction(async (transaction) => {
        if (members.length > 0) {
          await transaction.insert(snapshotAttemptMembers).values(
            members.map((member, index) => ({
              biliUid: member.biliUid,
              displayNameAtCapture: member.displayName,
              rawTier: member.rawTier,
              snapshotAttemptId: attemptId,
              sourcePage: pages.find((page) => page.members.includes(member))?.pageNumber ?? 1,
              sourcePosition: member.sourcePosition || index + 1,
              tier: member.tier,
            })),
          );
        }
        await transaction
          .update(snapshotAttempts)
          .set({
            captureCompletedAt: completedAt,
            consistencyStatus: 'CONSISTENT',
            declaredTotal: first.declaredTotal,
            normalizedTotal: members.length,
          })
          .where(eq(snapshotAttempts.id, attemptId));
        if (punctuality === 'ON_TIME') {
          if (members.length > 0) {
            await transaction.insert(snapshotMembers).values(
              members.map((member) => ({
                biliUid: member.biliUid,
                displayNameAtSnapshot: member.displayName,
                rawTier: member.rawTier,
                snapshotRunId: run.id,
                sourcePosition: member.sourcePosition,
                tier: member.tier,
              })),
            );
          }
          await transaction
            .update(snapshotRuns)
            .set({
              acceptedAttemptId: attemptId,
              finalizedAt: completedAt,
              status: 'FINALIZED',
              updatedAt: completedAt,
            })
            .where(eq(snapshotRuns.id, run.id));
          await this.onFinalized?.(run.id, transaction);
          await this.audit.record(
            {
              action: 'snapshot.finalized',
              actorUserId: null,
              afterSummary: { attemptId, memberCount: members.length, punctuality },
              creatorId: run.creatorId,
              targetId: run.id,
              targetType: 'snapshot-run',
            },
            transaction,
          );
        } else {
          await transaction
            .update(snapshotRuns)
            .set({ status: 'PENDING_APPROVAL', updatedAt: completedAt })
            .where(eq(snapshotRuns.id, run.id));
        }
      });
    } catch (error) {
      const captureFailure = failure(error);
      await this.database.orm.transaction(async (transaction) => {
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
    }
  }

  public async capture(runId: string): Promise<void> {
    const { attemptId, run } = await this.beginAttempt(runId, { initiatedBy: 'SCHEDULER' });
    await this.executeCapture(attemptId, run);
  }

  public async queueCapture(
    runId: string,
    context: RequestAuditContext,
  ): Promise<{ attemptId: string }> {
    const { attemptId, run } = await this.beginAttempt(runId, {
      context,
      initiatedBy: 'ADMIN',
    });
    const execution = this.executeCapture(attemptId, run);
    this.backgroundCaptures.add(execution);
    void execution
      .catch((error: unknown) => this.onBackgroundError?.(error))
      .finally(() => this.backgroundCaptures.delete(execution));
    return { attemptId };
  }

  public async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.backgroundCaptures]);
  }

  public async approveLate(runId: string, context: RequestAuditContext): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(snapshotRuns)
        .where(eq(snapshotRuns.id, runId))
        .limit(1)
        .for('update');
      if (!run || run.status !== 'PENDING_APPROVAL') {
        throw new AppError(
          'SNAPSHOT_NOT_APPROVABLE',
          'No consistent late attempt is pending.',
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
            eq(snapshotAttempts.punctuality, 'LATE'),
          ),
        )
        .orderBy(desc(snapshotAttempts.attemptNumber))
        .limit(1);
      if (!attempt) throw new AppError('SNAPSHOT_NOT_APPROVABLE', 'No late attempt exists.', 409);
      const candidates = await transaction
        .select()
        .from(snapshotAttemptMembers)
        .where(eq(snapshotAttemptMembers.snapshotAttemptId, attempt.id));
      if (candidates.length > 0) {
        await transaction.insert(snapshotMembers).values(
          candidates.map((member) => ({
            biliUid: member.biliUid,
            displayNameAtSnapshot: member.displayNameAtCapture,
            rawTier: member.rawTier,
            snapshotRunId: run.id,
            sourcePosition: member.sourcePosition,
            tier: member.tier,
          })),
        );
      }
      const now = this.clock.now();
      await transaction
        .update(snapshotRuns)
        .set({
          acceptedAttemptId: attempt.id,
          approvedAt: now,
          approvedBy: context.actorUserId,
          finalizedAt: now,
          status: 'FINALIZED',
          updatedAt: now,
        })
        .where(eq(snapshotRuns.id, run.id));
      await this.onFinalized?.(run.id, transaction);
      await this.audit.record(
        {
          action: 'snapshot.late-approved',
          actorUserId: context.actorUserId,
          afterSummary: { attemptId: attempt.id, memberCount: candidates.length },
          creatorId: run.creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: run.id,
          targetType: 'snapshot-run',
        },
        transaction,
      );
    });
  }

  public async rejectLate(runId: string, context: RequestAuditContext & { reason: string }) {
    const [run] = await this.database.orm
      .update(snapshotRuns)
      .set({ status: 'REJECTED', updatedAt: this.clock.now() })
      .where(and(eq(snapshotRuns.id, runId), eq(snapshotRuns.status, 'PENDING_APPROVAL')))
      .returning();
    if (!run) throw new AppError('SNAPSHOT_NOT_REJECTABLE', 'No late attempt is pending.', 409);
    await this.audit.record({
      action: 'snapshot.late-rejected',
      actorUserId: context.actorUserId,
      creatorId: run.creatorId,
      ipAddress: context.ipAddress,
      reason: context.reason,
      requestId: context.requestId,
      targetId: run.id,
      targetType: 'snapshot-run',
    });
    return run;
  }
}
