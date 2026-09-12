import { count, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotRuns,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import type { GuardRosterMember } from '../../src/server/modules/bilibili/guard-roster-source.js';
import { CreatorService } from '../../src/server/modules/creators/creator-service.js';
import { GiftEligibilityService } from '../../src/server/modules/gifts/eligibility-service.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';
import { SNAPSHOT_ATTEMPT_LIMIT } from '../../src/shared/contracts/snapshots.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import { FakeCreatorProfileSource } from '../helpers/fake-creator-profile-source.js';
import {
  buildFakeRosterScenario,
  FakeGuardRosterSource,
} from '../helpers/fake-guard-roster-source.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { insertScheduledSnapshot } from '../helpers/snapshot-fixture.js';

const member = (uid: string, position = 1): GuardRosterMember => ({
  biliUid: uid,
  displayName: `Member ${uid}`,
  sourcePosition: position,
  rawTier: '3',
  tier: 'CAPTAIN',
});

describe('snapshot capture and acceptance', () => {
  let fixture: IntegrationDatabase;
  let storage: TemporaryStorage;
  let now: Date;
  const clock = { now: () => now };
  const services: SnapshotService[] = [];

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('snapshots');
  });
  beforeEach(async () => {
    await fixture.database.orm.execute(sql`truncate users cascade`);
    storage = await createTemporaryStorage();
    now = new Date('2026-07-31T15:59:00Z');
  });
  afterEach(async () => {
    for (const service of services) service.beginShutdown();
    await Promise.all(services.splice(0).map((service) => service.waitForIdle()));
    vi.restoreAllMocks();
    await storage?.cleanup();
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });

  async function setup() {
    const database = fixture.database;
    const [user] = await database.orm
      .insert(users)
      .values({
        username: 'creator',
        bilibiliUid: '910001',
        name: 'Creator',
        role: 'CREATOR',
      })
      .returning();
    const creator = await insertTestCreator(database, {
      userId: user!.id,
      bilibiliUid: '910001',
      displayName: 'Creator',
      roomId: '810001',
    });
    const source = new FakeGuardRosterSource();
    const eligibility = new GiftEligibilityService();
    const service = new SnapshotService(database, storage.driver, source, clock, eligibility);
    services.push(service);
    return { database, creator, source, service, eligibility, context: { actorUserId: user!.id } };
  }

  it('schedules months idempotently and captures only due work', async () => {
    now = new Date('2026-07-22T00:00:00Z');
    const { service, creator, database } = await setup();
    expect(await service.precreateRuns()).toBe(2);
    expect(await service.precreateRuns()).toBe(0);
    expect(await service.runDue()).toBe(0);
    now = new Date('2026-07-31T15:59:00Z');
    expect(await service.runDue()).toBe(1);
    const runs = await database.orm
      .select()
      .from(snapshotRuns)
      .where(eq(snapshotRuns.creatorId, creator.id))
      .orderBy(snapshotRuns.periodStart);
    expect(runs.map(({ periodStart, status }) => ({ periodStart, status }))).toEqual([
      { periodStart: '2026-07-01', status: 'FINALIZED' },
      { periodStart: '2026-08-01', status: 'SCHEDULED' },
    ]);
  });

  it('seals an on-time roster and its evidence even when fetching crosses midnight', async () => {
    const { database, creator, source, service } = await setup();
    const run = await insertScheduledSnapshot(database, creator.id);
    const members = Array.from({ length: 31 }, (_, i) => member(String(1000 + i), i + 1));
    source.setScenario(buildFakeRosterScenario(members));
    const fetch = source.fetchPage.bind(source);
    vi.spyOn(source, 'fetchPage').mockImplementation(async (input) => {
      const page = await fetch(input);
      now = new Date('2026-07-31T16:01:00Z');
      return page;
    });
    await service.capture(run.id);
    const detail = await service.queries.getDetail(run.id);
    expect(detail.run.status).toBe('FINALIZED');
    expect(detail.attempts[0]).toMatchObject({
      punctuality: 'ON_TIME',
      normalizedTotal: members.length,
    });
    const evidence = await service.queries.listPages(run.id, detail.attempts[0]!.id, { limit: 10 });
    expect(evidence.items.map((page) => page.captureKind).sort()).toEqual([
      'PAGE',
      'PAGE',
      'RECHECK',
    ]);
    expect(
      (
        await service.queries.checkEvidenceIntegrity(run.id, detail.attempts[0]!.id, { limit: 10 })
      ).items.every((page) => page.ok),
    ).toBe(true);
    const first = await service.queries.listMembers(run.id, { limit: 20 });
    const second = await service.queries.listMembers(run.id, {
      limit: 20,
      cursor: first.nextCursor!,
    });
    expect([...first.items, ...second.items].map((row) => row.biliUid)).toEqual(
      members.map((row) => row.biliUid),
    );
    await expect(
      database.orm
        .update(snapshotAttemptMembers)
        .set({ displayNameAtCapture: 'tampered' })
        .where(eq(snapshotAttemptMembers.snapshotAttemptId, detail.attempts[0]!.id)),
    ).rejects.toThrow();
    await expect(
      database.orm
        .delete(snapshotAttemptMembers)
        .where(eq(snapshotAttemptMembers.snapshotAttemptId, detail.attempts[0]!.id)),
    ).rejects.toThrow();
  });

  it('accepts a late roster beyond the PostgreSQL parameter limit only after review', async () => {
    now = new Date('2026-08-01T00:00:00Z');
    const { database, creator, source, service, context } = await setup();
    const run = await insertScheduledSnapshot(database, creator.id);
    const total = 10_000;
    source.setScenario(
      buildFakeRosterScenario(
        Array.from({ length: total }, (_, i) => member(String(10000000 + i), i + 1)),
      ),
    );
    await service.capture(run.id);
    const pending = await service.queries.getDetail(run.id);
    expect(pending.run.status).toBe('PENDING_APPROVAL');
    expect((await service.queries.listMembers(run.id, { limit: 10 })).items).toEqual([]);
    const attemptId = pending.attempts[0]!.id;
    const [candidates] = await database.orm
      .select({ value: count() })
      .from(snapshotAttemptMembers)
      .where(eq(snapshotAttemptMembers.snapshotAttemptId, attemptId));
    expect(candidates?.value).toBe(total);
    await service.approveLate(run.id, attemptId, context);
    const accepted = await service.queries.getDetail(run.id);
    expect(accepted.run).toMatchObject({ status: 'FINALIZED', acceptedAttemptId: attemptId });
    const [members] = await database.orm
      .select({ value: count() })
      .from(snapshotAttemptMembers)
      .innerJoin(
        snapshotRuns,
        eq(snapshotRuns.acceptedAttemptId, snapshotAttemptMembers.snapshotAttemptId),
      )
      .where(eq(snapshotRuns.id, run.id));
    expect(members?.value).toBe(total);
    expect(await database.orm.select({ action: auditLogs.action }).from(auditLogs)).toContainEqual({
      action: 'snapshot.late-approved',
    });
  });

  it('keeps rejected evidence separate from a successful administrator retry', async () => {
    const { database, creator, source, service, context } = await setup();
    const run = await insertScheduledSnapshot(database, creator.id);
    source.setScenario(buildFakeRosterScenario([member('123', 1), member('123', 2)]));
    await service.capture(run.id);
    const failed = (await service.queries.getDetail(run.id)).attempts[0]!;
    expect(failed.failureCode).toBe('DUPLICATE_UID');
    expect(await database.orm.select().from(snapshotAttemptMembers)).toEqual([]);
    await expect(service.approveLate(run.id, failed.id, context)).rejects.toMatchObject({
      code: 'SNAPSHOT_NOT_APPROVABLE',
    });
    source.setScenario(buildFakeRosterScenario([member('123')]));
    const queued = await service.queueCapture(run.id, context);
    await service.waitForIdle();
    const detail = await service.queries.getDetail(run.id);
    expect(detail.run).toMatchObject({ status: 'FINALIZED', acceptedAttemptId: queued.attemptId });
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts.find((attempt) => attempt.id === queued.attemptId)).toMatchObject({
      initiatedBy: 'ADMIN',
      requestedByUserId: context.actorUserId,
    });
    for (const attempt of detail.attempts) {
      const pages = await service.queries.listPages(run.id, attempt.id, { limit: 10 });
      expect(pages.items.length).toBeGreaterThan(0);
      expect(pages.items.every((page) => page.snapshotAttemptId === attempt.id)).toBe(true);
    }
  });

  it('updates scheduled identity and cancels future work when monthly sync is disabled', async () => {
    now = new Date('2026-07-22T00:00:00Z');
    const { database, creator, service, context } = await setup();
    await service.precreateRuns();
    const creators = new CreatorService(database, new FakeCreatorProfileSource(), clock);
    await creators.refreshProfile({ ...context, creatorId: creator.id });
    await creators.updateSettings({ ...context, creatorId: creator.id, timezone: 'UTC' });
    const future = await database.orm.select().from(snapshotRuns);
    expect(future).toHaveLength(2);
    expect(
      future.every(
        (run) => run.creatorRoomId === creator.bilibiliUid && run.cutoffTimezone === 'UTC',
      ),
    ).toBe(true);
    await creators.updateSettings({ ...context, creatorId: creator.id, monthlySyncEnabled: false });
    expect(await database.orm.select({ status: snapshotRuns.status }).from(snapshotRuns)).toEqual(
      future.map(() => ({ status: 'CANCELLED' })),
    );
  });

  it('refuses further retries once the attempt budget is exhausted', async () => {
    const { database, creator, service, context } = await setup();
    const run = await insertScheduledSnapshot(database, creator.id);
    await database.orm.insert(snapshotAttempts).values(
      Array.from({ length: SNAPSHOT_ATTEMPT_LIMIT }, (_, i) => ({
        snapshotRunId: run.id,
        attemptNumber: i + 1,
        schedulerStartedAt: now,
        sourceName: 'fixture',
        sourceVersion: '1',
      })),
    );
    await database.orm
      .update(snapshotRuns)
      .set({ status: 'FAILED' })
      .where(eq(snapshotRuns.id, run.id));
    await expect(service.queueCapture(run.id, context)).rejects.toMatchObject({
      code: 'SNAPSHOT_ATTEMPT_LIMIT_REACHED',
    });
  });

  it('retries acceptance of durable evidence without fetching the roster again', async () => {
    const { database, creator, source, service, eligibility } = await setup();
    const run = await insertScheduledSnapshot(database, creator.id);
    source.setScenario(buildFakeRosterScenario([member('123')]));
    vi.spyOn(eligibility, 'reconcileSnapshot').mockRejectedValueOnce(
      new Error('eligibility unavailable'),
    );
    const fetch = vi.spyOn(source, 'fetchPage');
    await expect(service.capture(run.id)).rejects.toThrow('eligibility unavailable');
    expect((await service.queries.getDetail(run.id)).run.status).toBe('READY');
    fetch.mockClear();
    await service.runDue();
    expect((await service.queries.getDetail(run.id)).run.status).toBe('FINALIZED');
    expect(fetch).not.toHaveBeenCalled();
  });
});
