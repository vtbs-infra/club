import { and, count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  auditLogs,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotMembers,
  snapshotRuns,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import {
  buildFakeRosterScenario,
  FakeGuardRosterSource,
  type FakeRosterScenario,
} from '../../src/server/modules/bilibili/fake-guard-roster-source.js';
import type {
  BilibiliCreatorProfile,
  CreatorProfileSource,
} from '../../src/server/modules/bilibili/creator-profile-source.js';
import type {
  FetchGuardRosterPageInput,
  GuardRosterMember,
  GuardRosterPage,
  GuardRosterSource,
} from '../../src/server/modules/bilibili/guard-roster-source.js';
import { CreatorService } from '../../src/server/modules/creators/creator-service.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

class MutableClock implements Clock {
  public constructor(public current: Date) {}
  public now(): Date {
    return new Date(this.current);
  }
}

class MutableCreatorProfileSource implements CreatorProfileSource {
  public readonly name = 'mutable-test';
  public readonly version = 'v1';
  public profile: BilibiliCreatorProfile | null = null;

  public fetchByUid(biliUid: string): Promise<BilibiliCreatorProfile> {
    if (!this.profile || this.profile.biliUid !== biliUid) {
      return Promise.reject(new Error(`Missing creator profile fixture for ${biliUid}.`));
    }
    return Promise.resolve(this.profile);
  }
}

function member(uid: string, position: number, rawTier = '3'): GuardRosterMember {
  return {
    biliUid: uid,
    displayName: `Member ${uid}`,
    rawTier,
    sourcePosition: position,
    tier:
      rawTier === '1'
        ? 'GOVERNOR'
        : rawTier === '2'
          ? 'ADMIRAL'
          : rawTier === '3'
            ? 'CAPTAIN'
            : null,
  };
}

class AdvancingSource implements GuardRosterSource {
  public readonly name = 'advancing-fake';
  public readonly version = '1';
  private calls = 0;
  public constructor(
    private readonly delegate: FakeGuardRosterSource,
    private readonly clock: MutableClock,
    private readonly completionTime: Date,
  ) {}
  public async fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage> {
    const page = await this.delegate.fetchPage(input);
    this.calls += 1;
    if (this.calls === 1) this.clock.current = this.completionTime;
    return page;
  }
}

class ConcurrentEmptySource implements GuardRosterSource {
  public readonly name = 'concurrent-fake';
  public readonly version = '1';
  public maximumConcurrentRequests = 0;
  private concurrentRequests = 0;

  public async fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage> {
    this.concurrentRequests += 1;
    this.maximumConcurrentRequests = Math.max(
      this.maximumConcurrentRequests,
      this.concurrentRequests,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.concurrentRequests -= 1;
    return {
      declaredPageCount: 1,
      declaredTotal: 0,
      fetchedAt: new Date(),
      members: [],
      pageNumber: input.pageNumber,
      rawBytes: new TextEncoder().encode(
        JSON.stringify({ pageNumber: input.pageNumber, roomId: input.roomId }),
      ),
    };
  }
}

class BlockingEmptySource implements GuardRosterSource {
  public readonly name = 'blocking-fake';
  public readonly version = '1';
  public readonly entered: Promise<void>;
  private firstRequest = true;
  private readonly gate: Promise<void>;
  private markEntered!: () => void;
  private releaseGate!: () => void;

  public constructor() {
    this.entered = new Promise((resolve) => {
      this.markEntered = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
  }

  public release(): void {
    this.releaseGate();
  }

  public async fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage> {
    if (this.firstRequest) {
      this.firstRequest = false;
      this.markEntered();
      await this.gate;
    }
    return {
      declaredPageCount: 1,
      declaredTotal: 0,
      fetchedAt: new Date(),
      members: [],
      pageNumber: input.pageNumber,
      rawBytes: new TextEncoder().encode(JSON.stringify({ pageNumber: input.pageNumber })),
    };
  }
}

class AbortableBlockingSource implements GuardRosterSource {
  public readonly name = 'abortable-blocking-fake';
  public readonly version = '1';
  public readonly entered: Promise<void>;
  private markEntered!: () => void;

  public constructor() {
    this.entered = new Promise((resolve) => {
      this.markEntered = resolve;
    });
  }

  public fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage> {
    this.markEntered();
    return new Promise((_resolve, reject) => {
      const rejectAborted = () =>
        reject(
          input.signal.reason instanceof Error
            ? input.signal.reason
            : new Error('Snapshot capture aborted.'),
        );
      if (input.signal.aborted) rejectAborted();
      else input.signal.addEventListener('abort', rejectAborted, { once: true });
    });
  }
}

integration('month-end snapshot capture', () => {
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let storage: TemporaryStorage;
  let ownerId: string;
  const creatorIds: string[] = [];

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('snapshots');
    database = integrationDatabase.database;
    storage = await createTemporaryStorage();
    const [owner] = await database.orm
      .insert(users)
      .values({ email: 'snapshot-owner@example.com', name: 'Snapshot Owner' })
      .returning({ id: users.id });
    ownerId = owner!.id;
    for (let index = 1; index <= 20; index += 1) {
      const [account] = await database.orm
        .insert(users)
        .values({
          email: `creator-${index}@example.com`,
          name: `Creator ${index}`,
          role: 'CREATOR',
        })
        .returning({ id: users.id });
      const creator = await insertTestCreator(database, {
        bilibiliUid: `9000${index}`,
        displayName: `Creator ${index}`,
        roomId: `8000${index}`,
        timezone: 'Asia/Shanghai',
        userId: account!.id,
      });
      creatorIds.push(creator.id);
    }
  });

  afterAll(async () => {
    if (storage) await storage.cleanup();
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  async function julyRun(creatorId: string) {
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(eq(snapshotRuns.creatorId, creatorId), eq(snapshotRuns.periodStart, '2026-07-01')),
      );
    return run!;
  }

  it('pre-creates current and next runs and freezes exact cutoff fields', async () => {
    const clock = new MutableClock(new Date('2026-07-22T00:00:00.000Z'));
    const source = new FakeGuardRosterSource();
    const service = new SnapshotService(database, storage.driver, source, clock);
    expect(await service.precreateRuns()).toBe(40);
    expect(await service.precreateRuns()).toBe(0);
    const runs = await database.orm
      .select()
      .from(snapshotRuns)
      .where(eq(snapshotRuns.creatorId, creatorIds[0]!));
    expect(runs.map((run) => run.periodStart).sort()).toEqual(['2026-07-01', '2026-08-01']);
    expect(runs.find((run) => run.periodStart === '2026-07-01')).toMatchObject({
      cutoffTimezone: 'Asia/Shanghai',
      scheduledCutoffAt: new Date('2026-07-31T15:59:00.000Z'),
    });
  });

  it('keeps a 23:59 capture on time when completion crosses midnight', async () => {
    const clock = new MutableClock(new Date('2026-07-31T15:59:00.000Z'));
    const fake = new FakeGuardRosterSource();
    fake.setScenario(
      buildFakeRosterScenario(
        Array.from({ length: 35 }, (_, i) => member(String(1000 + i), i + 1)),
      ),
    );
    const source = new AdvancingSource(fake, clock, new Date('2026-07-31T16:01:00.000Z'));
    const service = new SnapshotService(database, storage.driver, source, clock);
    const run = await julyRun(creatorIds[0]!);
    await service.capture(run.id);

    const detail = await service.queries.getDetail(run.id);
    expect(detail.run.status).toBe('FINALIZED');
    expect(detail.attempts[0]).toMatchObject({
      consistencyStatus: 'CONSISTENT',
      declaredTotal: 35,
      normalizedTotal: 35,
      punctuality: 'ON_TIME',
    });
    expect(detail.pages).toHaveLength(3);
    expect(detail.pages.map((page) => page.captureKind).sort()).toEqual([
      'PAGE',
      'PAGE',
      'RECHECK',
    ]);
    expect(detail.pages.every((page) => page.declaredTotal === 35)).toBe(true);
    expect((await service.queries.checkEvidenceIntegrity(run.id)).every((page) => page.ok)).toBe(
      true,
    );
    const [total] = await database.orm
      .select({ value: count() })
      .from(snapshotMembers)
      .where(eq(snapshotMembers.snapshotRunId, run.id));
    expect(total?.value).toBe(35);
  });

  it('holds a consistent late attempt for approval without creating members', async () => {
    const clock = new MutableClock(new Date('2026-07-31T16:00:00.000Z'));
    const source = new FakeGuardRosterSource();
    source.setScenario(buildFakeRosterScenario([member('2001', 1, '1')]));
    const service = new SnapshotService(database, storage.driver, source, clock);
    const run = await julyRun(creatorIds[1]!);
    await service.capture(run.id);
    expect((await service.queries.getDetail(run.id)).run.status).toBe('PENDING_APPROVAL');
    const [before] = await database.orm
      .select({ value: count() })
      .from(snapshotMembers)
      .where(eq(snapshotMembers.snapshotRunId, run.id));
    expect(before?.value).toBe(0);

    await service.approveLate(run.id, {
      actorUserId: ownerId,
      ipAddress: '127.0.0.1',
      requestId: 'late-approval-test',
    });
    expect((await service.queries.getDetail(run.id)).run.status).toBe('FINALIZED');
    const [audit] = await database.orm
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'snapshot.late-approved'));
    expect(audit?.action).toBe('snapshot.late-approved');
  });

  it('keeps failed attempts separate and never persists candidates before consistency', async () => {
    const clock = new MutableClock(new Date('2026-07-31T15:59:10.000Z'));
    const source = new FakeGuardRosterSource();
    source.setScenario(buildFakeRosterScenario([member('3001', 1), member('3001', 2)]));
    const service = new SnapshotService(database, storage.driver, source, clock);
    const run = await julyRun(creatorIds[2]!);
    await service.capture(run.id);
    expect((await service.queries.getDetail(run.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'DUPLICATE_UID',
    });
    await expect(
      service.approveLate(run.id, {
        actorUserId: ownerId,
        ipAddress: '127.0.0.1',
        requestId: 'inconsistent-approval-test',
      }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_APPROVABLE' });
    const failedDetail = await service.queries.getDetail(run.id);
    const [candidates] = await database.orm
      .select({ value: count() })
      .from(snapshotAttemptMembers)
      .where(eq(snapshotAttemptMembers.snapshotAttemptId, failedDetail.attempts[0]!.id));
    expect(candidates?.value).toBe(0);

    source.setScenario(buildFakeRosterScenario([member('3001', 1), member('3002', 2)]));
    await service.queueCapture(run.id, {
      actorUserId: ownerId,
      ipAddress: '127.0.0.1',
      requestId: 'retry-consistency-failure',
    });
    await service.waitForIdle();
    const detail = await service.queries.getDetail(run.id);
    expect(detail.attempts.map((attempt) => attempt.attemptNumber).sort()).toEqual([1, 2]);
    expect(new Set(detail.pages.map((page) => page.snapshotAttemptId)).size).toBe(2);
    expect(detail.run.status).toBe('FINALIZED');
  });

  it.each([
    ['UNKNOWN_TIER', 3],
    ['COUNT_DRIFT', 4],
    ['FIRST_PAGE_DRIFT', 5],
    ['MISSING_PAGE', 6],
  ] as const)('rejects %s inconsistent captures', async (failureCode, creatorIndex) => {
    const clock = new MutableClock(new Date('2026-07-31T15:59:20.000Z'));
    const source = new FakeGuardRosterSource();
    let scenario: FakeRosterScenario;
    if (failureCode === 'UNKNOWN_TIER') {
      scenario = buildFakeRosterScenario([member('4001', 1, '9')]);
    } else {
      const base = buildFakeRosterScenario(
        Array.from({ length: 31 }, (_, i) => member(String(5000 + i), i + 1)),
      );
      const pages = new Map(base.pages);
      if (failureCode === 'COUNT_DRIFT') {
        pages.set(2, { ...pages.get(2)!, declaredTotal: 32 });
      } else if (failureCode === 'MISSING_PAGE') {
        pages.set(2, { ...pages.get(2)!, pageNumber: 3 });
      }
      scenario =
        failureCode === 'FIRST_PAGE_DRIFT'
          ? {
              pages,
              refetchedFirstPage: {
                ...pages.get(1)!,
                members: [member('999999', 1), ...pages.get(1)!.members.slice(1)],
              },
            }
          : { pages };
    }
    source.setScenario(scenario);
    const service = new SnapshotService(database, storage.driver, source, clock);
    const run = await julyRun(creatorIds[creatorIndex]!);
    await service.capture(run.id);
    expect((await service.queries.getDetail(run.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode,
    });
  });

  it('prevents direct update and delete of finalized members', async () => {
    const run = await julyRun(creatorIds[0]!);
    await expect(
      database.orm
        .update(snapshotMembers)
        .set({ displayNameAtSnapshot: 'tampered' })
        .where(eq(snapshotMembers.snapshotRunId, run.id)),
    ).rejects.toThrow();
    await expect(
      database.orm.delete(snapshotMembers).where(eq(snapshotMembers.snapshotRunId, run.id)),
    ).rejects.toThrow();
  });

  it('marks an interrupted attempt failed for administrator review', async () => {
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(eq(snapshotRuns.creatorId, creatorIds[7]!))
      .orderBy(snapshotRuns.periodStart);
    await database.orm.insert(snapshotAttempts).values({
      attemptNumber: 1,
      schedulerStartedAt: new Date('2026-07-22T00:00:00.000Z'),
      snapshotRunId: run!.id,
      sourceName: 'fake',
      sourceVersion: '1',
    });
    await database.orm
      .update(snapshotRuns)
      .set({ status: 'RUNNING' })
      .where(eq(snapshotRuns.id, run!.id));
    const service = new SnapshotService(
      database,
      storage.driver,
      new FakeGuardRosterSource(),
      new MutableClock(new Date('2026-07-31T16:05:00.000Z')),
    );
    expect(await service.recoverInterrupted()).toBe(1);
    expect((await service.queries.getDetail(run!.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'PROCESS_INTERRUPTED',
    });
    expect((await service.queries.getDetail(run!.id)).retry).toEqual({
      canRetry: true,
      remainingAttempts: 2,
    });
  });

  it('starts due creators concurrently without exceeding the scheduler limit', async () => {
    const clock = new MutableClock(new Date('2026-07-31T15:59:40.000Z'));
    const source = new ConcurrentEmptySource();
    const service = new SnapshotService(database, storage.driver, source, clock);

    expect(await service.runDue()).toBeGreaterThanOrEqual(12);

    const newCreatorRuns = await database.orm
      .select({ status: snapshotRuns.status })
      .from(snapshotRuns)
      .where(
        and(
          inArray(snapshotRuns.creatorId, creatorIds.slice(8)),
          eq(snapshotRuns.periodStart, '2026-07-01'),
        ),
      );
    expect(newCreatorRuns).toHaveLength(12);
    expect(newCreatorRuns.every((run) => run.status === 'FINALIZED')).toBe(true);
    expect(source.maximumConcurrentRequests).toBeGreaterThan(1);
    expect(source.maximumConcurrentRequests).toBeLessThanOrEqual(4);
    const failedRun = await julyRun(creatorIds[3]!);
    expect((await service.queries.getDetail(failedRun.id)).attempts).toHaveLength(1);
  });

  it('records administrator retries and waits for queued captures during shutdown', async () => {
    const clock = new MutableClock(new Date('2026-08-31T15:59:30.000Z'));
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, creatorIds[11]!),
          eq(snapshotRuns.periodStart, '2026-08-01'),
        ),
      );
    const failedSource = new FakeGuardRosterSource();
    failedSource.setScenario(
      buildFakeRosterScenario([
        member('administrator-retry-member', 1),
        member('administrator-retry-member', 2),
      ]),
    );
    await new SnapshotService(database, storage.driver, failedSource, clock).capture(run!.id);
    const source = new BlockingEmptySource();
    const service = new SnapshotService(database, storage.driver, source, clock);
    const queued = await service.queueCapture(run!.id, {
      actorUserId: ownerId,
      ipAddress: '127.0.0.1',
      requestId: 'administrator-snapshot-retry',
    });
    await source.entered;
    source.release();
    await service.waitForIdle();

    const detail = await service.queries.getDetail(run!.id);
    expect(detail.run.status).toBe('FINALIZED');
    expect(detail.attempts[0]).toMatchObject({
      id: queued.attemptId,
      initiatedBy: 'ADMIN',
      requestedByUserId: ownerId,
    });
    const [audit] = await database.orm
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'snapshot.retry-started'));
    expect(audit?.action).toBe('snapshot.retry-started');
  });

  it('updates future task identity and cancels tasks when monthly sync is disabled', async () => {
    const clock = new MutableClock(new Date('2026-07-22T00:00:00.000Z'));
    const profiles = new MutableCreatorProfileSource();
    const creatorService = new CreatorService(database, profiles, clock);
    const creatorId = creatorIds[8]!;
    profiles.profile = {
      biliUid: '90009',
      displayName: 'Refreshed Creator 9',
      roomId: '880009',
    };
    await creatorService.refreshProfile({
      actorUserId: ownerId,
      creatorId,
      ipAddress: '127.0.0.1',
      requestId: 'refresh-scheduled-snapshot',
    });
    await creatorService.updateSettings({
      actorUserId: ownerId,
      creatorId,
      ipAddress: '127.0.0.1',
      requestId: 'update-scheduled-snapshot-timezone',
      timezone: 'UTC',
    });
    const [updatedRun] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(eq(snapshotRuns.creatorId, creatorId), eq(snapshotRuns.periodStart, '2026-08-01')),
      );
    expect(updatedRun).toMatchObject({
      creatorRoomId: '880009',
      cutoffTimezone: 'UTC',
      scheduledCutoffAt: new Date('2026-08-31T23:59:00.000Z'),
      status: 'SCHEDULED',
    });

    await creatorService.updateSettings({
      actorUserId: ownerId,
      creatorId,
      ipAddress: '127.0.0.1',
      monthlySyncEnabled: false,
      requestId: 'disable-scheduled-snapshot',
    });
    const pending = await database.orm
      .select({ status: snapshotRuns.status })
      .from(snapshotRuns)
      .where(
        and(eq(snapshotRuns.creatorId, creatorId), eq(snapshotRuns.periodStart, '2026-08-01')),
      );
    expect(pending).toEqual([{ status: 'CANCELLED' }]);
  });

  it('rejects a concurrent retry and enforces the shared attempt limit', async () => {
    const clock = new MutableClock(new Date('2026-08-31T15:59:30.000Z'));
    const [concurrentRun] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(eq(snapshotRuns.creatorId, creatorIds[9]!), eq(snapshotRuns.periodStart, '2026-08-01')),
      );
    const source = new BlockingEmptySource();
    const service = new SnapshotService(database, storage.driver, source, clock);
    const firstCapture = service.capture(concurrentRun!.id);
    await source.entered;
    await expect(service.capture(concurrentRun!.id)).rejects.toMatchObject({
      code: 'SNAPSHOT_CAPTURE_NOT_ALLOWED',
    });
    source.release();
    await firstCapture;

    const [limitedRun] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, creatorIds[10]!),
          eq(snapshotRuns.periodStart, '2026-08-01'),
        ),
      );
    await database.orm.insert(snapshotAttempts).values(
      [1, 2, 3].map((attemptNumber) => ({
        attemptNumber,
        schedulerStartedAt: clock.now(),
        snapshotRunId: limitedRun!.id,
        sourceName: 'failed-fake',
        sourceVersion: '1',
      })),
    );
    await database.orm
      .update(snapshotRuns)
      .set({ status: 'FAILED' })
      .where(eq(snapshotRuns.id, limitedRun!.id));
    await expect(
      service.queueCapture(limitedRun!.id, {
        actorUserId: ownerId,
        ipAddress: '127.0.0.1',
        requestId: 'attempt-limit-test',
      }),
    ).rejects.toMatchObject({
      code: 'SNAPSHOT_ATTEMPT_LIMIT_REACHED',
    });
  });

  it('rejects oversized pagination before requesting or storing later pages', async () => {
    const clock = new MutableClock(new Date('2026-08-31T15:59:30.000Z'));
    let requests = 0;
    const source: GuardRosterSource = {
      name: 'oversized-pagination-fake',
      version: '1',
      fetchPage: (input) => {
        requests += 1;
        return Promise.resolve({
          declaredPageCount: 1_001,
          declaredTotal: 1,
          fetchedAt: clock.now(),
          members: [member('oversized-page-member', 1)],
          pageNumber: input.pageNumber,
          rawBytes: new TextEncoder().encode('{}'),
        });
      },
    };
    const service = new SnapshotService(database, storage.driver, source, clock);
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, creatorIds[13]!),
          eq(snapshotRuns.periodStart, '2026-08-01'),
        ),
      );

    await service.capture(run!.id);

    expect(requests).toBe(1);
    expect((await service.queries.getDetail(run!.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'PAGE_LIMIT_EXCEEDED',
    });
    expect((await service.queries.getDetail(run!.id)).pages).toHaveLength(0);
  });

  it('records a deterministic failure when graceful shutdown cancels a capture', async () => {
    const clock = new MutableClock(new Date('2026-08-31T15:59:30.000Z'));
    const source = new AbortableBlockingSource();
    const service = new SnapshotService(database, storage.driver, source, clock);
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, creatorIds[12]!),
          eq(snapshotRuns.periodStart, '2026-08-01'),
        ),
      );
    const capture = service.capture(run!.id);
    await source.entered;

    service.beginShutdown();
    await service.waitForIdle();
    await capture;

    expect((await service.queries.getDetail(run!.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'PROCESS_SHUTDOWN',
    });
  });

  it('fails the whole attempt when the provider exceeds its timeout', async () => {
    const clock = new MutableClock(new Date('2026-08-31T15:59:30.000Z'));
    const source: GuardRosterSource = {
      name: 'timeout-fake',
      version: '1',
      fetchPage: async (input) =>
        new Promise<GuardRosterPage>((_resolve, reject) => {
          input.signal.addEventListener(
            'abort',
            () =>
              reject(
                input.signal.reason instanceof Error
                  ? input.signal.reason
                  : new Error('Capture aborted.'),
              ),
            { once: true },
          );
        }),
    };
    const service = new SnapshotService(database, storage.driver, source, clock, 5);
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(eq(snapshotRuns.creatorId, creatorIds[7]!), eq(snapshotRuns.periodStart, '2026-08-01')),
      );
    await service.capture(run!.id);
    expect((await service.queries.getDetail(run!.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'CAPTURE_TIMEOUT',
    });
  });

  it('rolls back finalized members when termination happens during finalization', async () => {
    const [account] = await database.orm
      .insert(users)
      .values({
        email: 'termination-creator@example.com',
        name: 'Termination Creator',
        role: 'CREATOR',
      })
      .returning({ id: users.id });
    const creator = await insertTestCreator(database, {
      bilibiliUid: '99001',
      displayName: 'Termination Creator',
      roomId: '89001',
      timezone: 'Asia/Shanghai',
      userId: account!.id,
    });
    const clock = new MutableClock(new Date('2026-07-22T00:00:00.000Z'));
    const source = new FakeGuardRosterSource();
    source.setScenario(buildFakeRosterScenario([member('termination-member', 1)]));
    const service = new SnapshotService(database, storage.driver, source, clock, 120_000, () =>
      Promise.reject(new Error('simulated termination during finalization')),
    );
    await service.precreateRuns();
    clock.current = new Date('2026-07-31T15:59:00.000Z');
    const run = await julyRun(creator.id);
    await service.capture(run.id);
    const detail = await service.queries.getDetail(run.id);
    expect(detail.run.status).toBe('FAILED');
    expect(detail.attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'SOURCE_FAILURE',
    });
    const [members] = await database.orm
      .select({ value: count() })
      .from(snapshotMembers)
      .where(eq(snapshotMembers.snapshotRunId, run.id));
    expect(members?.value).toBe(0);
  });
});
