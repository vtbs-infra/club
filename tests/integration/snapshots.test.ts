import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  auditLogs,
  creators,
  organizations,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotMembers,
  snapshotRuns,
  users,
} from '../../src/server/infrastructure/db/schema.js';
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
  FetchGuardRosterPageInput,
  GuardRosterMember,
  GuardRosterPage,
  GuardRosterSource,
} from '../../src/server/modules/bilibili/guard-roster-source.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

class MutableClock implements Clock {
  public constructor(public current: Date) {}
  public now(): Date {
    return new Date(this.current);
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

integration('month-end snapshot capture', () => {
  let database: DatabaseService;
  let storage: TemporaryStorage;
  let organizationId: string;
  let ownerId: string;
  const creatorIds: string[] = [];

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    storage = await createTemporaryStorage();
    await database.orm.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        snapshot_members,
        snapshot_attempt_members,
        snapshot_pages,
        snapshot_attempts,
        snapshot_runs,
        bilibili_bindings,
        binding_challenges,
        verification_rooms,
        member_creator_scopes,
        creators,
        organization_members,
        organizations,
        sessions,
        accounts,
        verifications,
        users
      CASCADE
    `);
    const [owner] = await database.orm
      .insert(users)
      .values({ email: 'snapshot-owner@example.com', name: 'Snapshot Owner' })
      .returning({ id: users.id });
    ownerId = owner!.id;
    const [organization] = await database.orm
      .insert(organizations)
      .values({ name: 'Snapshot Org', slug: 'snapshot-org' })
      .returning({ id: organizations.id });
    organizationId = organization!.id;
    for (let index = 1; index <= 8; index += 1) {
      const [creator] = await database.orm
        .insert(creators)
        .values({
          bilibiliUid: `9000${index}`,
          displayName: `Creator ${index}`,
          organizationId,
          roomId: `8000${index}`,
          timezone: 'Asia/Shanghai',
        })
        .returning({ id: creators.id });
      creatorIds.push(creator!.id);
    }
  });

  afterAll(async () => {
    if (database) await database.close();
    if (storage) await storage.cleanup();
  });

  async function julyRun(creatorId: string) {
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(eq(snapshotRuns.creatorId, creatorId));
    return run!;
  }

  it('pre-creates current and next runs and freezes exact cutoff fields', async () => {
    const clock = new MutableClock(new Date('2026-07-22T00:00:00.000Z'));
    const source = new FakeGuardRosterSource();
    const service = new SnapshotService(database, storage.driver, source, clock);
    expect(await service.precreateRuns()).toBe(16);
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

    const detail = await service.getDetail(run.id);
    expect(detail.run.status).toBe('FINALIZED');
    expect(detail.attempts[0]).toMatchObject({
      consistencyStatus: 'CONSISTENT',
      declaredTotal: 35,
      normalizedTotal: 35,
      punctuality: 'ON_TIME',
    });
    expect(detail.pages).toHaveLength(2);
    expect((await service.checkEvidenceIntegrity(run.id)).every((page) => page.ok)).toBe(true);
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
    expect((await service.getDetail(run.id)).run.status).toBe('PENDING_APPROVAL');
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
    expect((await service.getDetail(run.id)).run.status).toBe('FINALIZED');
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
    expect((await service.getDetail(run.id)).attempts[0]).toMatchObject({
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
    const failedDetail = await service.getDetail(run.id);
    const [candidates] = await database.orm
      .select({ value: count() })
      .from(snapshotAttemptMembers)
      .where(eq(snapshotAttemptMembers.snapshotAttemptId, failedDetail.attempts[0]!.id));
    expect(candidates?.value).toBe(0);

    source.setScenario(buildFakeRosterScenario([member('3001', 1), member('3002', 2)]));
    await service.capture(run.id);
    const detail = await service.getDetail(run.id);
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
    expect((await service.getDetail(run.id)).attempts[0]).toMatchObject({
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

  it('marks an interrupted attempt failed so the scheduler can retry it', async () => {
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
      new MutableClock(new Date('2026-07-22T00:05:00.000Z')),
    );
    expect(await service.recoverInterrupted()).toBe(1);
    expect((await service.getDetail(run!.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'PROCESS_INTERRUPTED',
    });
  });

  it('fails the whole attempt when the provider exceeds its timeout', async () => {
    const clock = new MutableClock(new Date('2026-07-31T15:59:30.000Z'));
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
    const run = await julyRun(creatorIds[7]!);
    await service.capture(run.id);
    expect((await service.getDetail(run.id)).attempts[0]).toMatchObject({
      consistencyStatus: 'INCONSISTENT',
      failureCode: 'CAPTURE_TIMEOUT',
    });
  });

  it('rolls back finalized members when termination happens during finalization', async () => {
    const [creator] = await database.orm
      .insert(creators)
      .values({
        bilibiliUid: 'termination-creator',
        displayName: 'Termination Creator',
        organizationId,
        roomId: 'termination-room',
        timezone: 'Asia/Shanghai',
      })
      .returning({ id: creators.id });
    const clock = new MutableClock(new Date('2026-07-22T00:00:00.000Z'));
    const source = new FakeGuardRosterSource();
    source.setScenario(buildFakeRosterScenario([member('termination-member', 1)]));
    const service = new SnapshotService(database, storage.driver, source, clock, 120_000, () =>
      Promise.reject(new Error('simulated termination during finalization')),
    );
    await service.precreateRuns();
    clock.current = new Date('2026-07-31T15:59:00.000Z');
    const run = await julyRun(creator!.id);
    await service.capture(run.id);
    const detail = await service.getDetail(run.id);
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
