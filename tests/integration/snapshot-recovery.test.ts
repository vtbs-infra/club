import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { snapshotRuns, users } from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { GiftEligibilityService } from '../../src/server/modules/gifts/eligibility-service.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import {
  buildFakeRosterScenario,
  FakeGuardRosterSource,
} from '../helpers/fake-guard-roster-source.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

describe('snapshot execution ownership and reviewed evidence', () => {
  let fixture: IntegrationDatabase;
  let storage: TemporaryStorage;
  let sequence = 0;
  const clock = { now: () => new Date('2026-08-01T00:00:00.000Z') };

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('snapshot_recovery');
    storage = await createTemporaryStorage();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await storage?.cleanup();
    await fixture?.cleanup();
  });

  async function setup() {
    const userId = randomUUID();
    sequence += 1;
    await fixture.database.orm.insert(users).values({
      id: userId,
      username: `reviewer_${sequence}`,
      bilibiliUid: String(50000 + sequence),
      name: 'Reviewer',
      role: 'PLATFORM_ADMIN',
    });
    const creator = await insertTestCreator(fixture.database, {
      userId,
      bilibiliUid: String(50000 + sequence),
      roomId: String(60000 + sequence),
      displayName: 'Creator',
    });
    const [run] = await fixture.database.orm
      .insert(snapshotRuns)
      .values({
        creatorId: creator.id,
        creatorBilibiliUid: creator.bilibiliUid,
        creatorRoomId: creator.roomId,
        periodStart: '2026-07-01',
        cutoffTimezone: 'Asia/Shanghai',
        scheduledCutoffAt: new Date('2026-07-31T15:59:00.000Z'),
        onTimeWindowEndAt: new Date('2026-07-31T16:09:00.000Z'),
      })
      .returning();
    const source = new FakeGuardRosterSource();
    const service = new SnapshotService(
      fixture.database,
      storage.driver,
      source,
      clock,
      new GiftEligibilityService(),
    );
    return { context: { actorUserId: userId }, run: run!, source, service };
  }

  it('records failure when the first write after beginning an attempt fails', async () => {
    const { run, service, source } = await setup();
    const fetch = vi.spyOn(source, 'fetchPage');
    vi.spyOn(fixture.database.orm, 'update').mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    await service.capture(run.id);
    const detail = await service.queries.getDetail(run.id);
    expect(detail.run.status).toBe('FAILED');
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]).toMatchObject({
      failureCode: 'SOURCE_FAILURE',
      consistencyStatus: 'INCONSISTENT',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recovers abandoned work on the next scheduler pass when failure persistence also fails', async () => {
    const { run, service, source } = await setup();
    const fetch = vi.spyOn(source, 'fetchPage').mockImplementationOnce(() => {
      vi.spyOn(fixture.database.orm, 'transaction').mockRejectedValueOnce(
        new Error('failure write unavailable'),
      );
      return Promise.reject(new Error('source unavailable'));
    });
    await expect(service.capture(run.id)).rejects.toThrow('failure write unavailable');
    await service.waitForIdle();
    expect((await service.queries.getDetail(run.id)).run.status).toBe('RUNNING');
    await service.runDue();
    const detail = await service.queries.getDetail(run.id);
    expect(detail.run.status).toBe('FAILED');
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.failureCode).toBe('PROCESS_INTERRUPTED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not recover an execution that still owns its running row', async () => {
    const { run, service, source } = await setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = source.fetchPage.bind(source);
    vi.spyOn(source, 'fetchPage').mockImplementationOnce(async (input) => {
      entered.resolve();
      await release.promise;
      return original(input);
    });
    const capture = service.capture(run.id);
    try {
      await entered.promise;
      expect(await service.recoverInterrupted()).toBe(0);
      expect((await service.queries.getDetail(run.id)).run.status).toBe('RUNNING');
    } finally {
      release.resolve();
      await capture;
    }
    expect((await service.queries.getDetail(run.id)).run.status).toBe('PENDING_APPROVAL');
  });

  it('waits for attempt startup and persists cancellation before shutdown completes', async () => {
    const { run, service, source } = await setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = fixture.database.orm.transaction.bind(fixture.database.orm);
    vi.spyOn(fixture.database.orm, 'transaction').mockImplementationOnce(async (action, config) => {
      entered.resolve();
      await release.promise;
      return original(action, config);
    });
    const fetching = vi.spyOn(source, 'fetchPage');
    const capture = service.capture(run.id);
    await entered.promise;
    service.beginShutdown();
    let drained = false;
    const closing = service.waitForIdle().then(() => {
      drained = true;
    });
    try {
      await Promise.resolve();
      expect(drained).toBe(false);
    } finally {
      release.resolve();
      await capture;
      await closing;
    }
    const detail = await service.queries.getDetail(run.id);
    expect(detail.run.status).toBe('FAILED');
    expect(detail.attempts[0]?.failureCode).toBe('PROCESS_SHUTDOWN');
    expect(fetching).not.toHaveBeenCalled();
  });

  it('rejects an approval or rejection of a superseded attempt', async () => {
    const { run, service, source, context } = await setup();
    const roster = (biliUid: string) =>
      buildFakeRosterScenario([
        { biliUid, displayName: 'Member', rawTier: '3', tier: 'CAPTAIN', sourcePosition: 1 },
      ]);
    source.setScenario(roster('111'));
    await service.capture(run.id);
    const first = (await service.queries.getDetail(run.id)).attempts[0]!.id;
    await service.rejectLate(run.id, first, { ...context, reason: 'Capture again' });
    source.setScenario(roster('222'));
    await service.queueCapture(run.id, context);
    await service.waitForIdle();
    const second = (await service.queries.getDetail(run.id)).attempts[0]!.id;
    expect(first).not.toBe(second);
    await expect(service.approveLate(run.id, first, context)).rejects.toMatchObject({
      code: 'SNAPSHOT_ATTEMPT_CONFLICT',
      statusCode: 409,
    });
    await expect(
      service.rejectLate(run.id, first, { ...context, reason: 'Stale rejection' }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_ATTEMPT_CONFLICT' });
    expect((await service.queries.getDetail(run.id)).run.status).toBe('PENDING_APPROVAL');
    await service.approveLate(run.id, second, context);
    await service.approveLate(run.id, second, context);
    await expect(service.approveLate(run.id, first, context)).rejects.toMatchObject({
      code: 'SNAPSHOT_ATTEMPT_CONFLICT',
    });
    expect(
      (await service.queries.listMembers(run.id, { limit: 10 })).items.map(
        (member) => member.biliUid,
      ),
    ).toEqual(['222']);
  });

  it('aborts and drains sibling page requests before sealing a failed capture', async () => {
    const { run, service, source } = await setup();
    const siblingEntered = Promise.withResolvers<void>();
    const siblingAborted = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    const emptyPage = buildFakeRosterScenario([]).pages.get(1)!;
    vi.spyOn(source, 'fetchPage').mockImplementation(async (input) => {
      if (input.pageNumber === 1) return { ...emptyPage, declaredPageCount: 3 };
      if (input.pageNumber === 2) {
        await siblingEntered.promise;
        throw new Error('page two failed');
      }
      input.signal.addEventListener('abort', () => siblingAborted.resolve(), { once: true });
      siblingEntered.resolve();
      await siblingAborted.promise;
      await releaseCleanup.promise;
      input.signal.throwIfAborted();
      throw new Error('Expected cancellation');
    });
    let settled = false;
    const capture = service.capture(run.id).finally(() => {
      settled = true;
    });
    try {
      await siblingAborted.promise;
      expect(settled).toBe(false);
      expect((await service.queries.getDetail(run.id)).run.status).toBe('RUNNING');
    } finally {
      releaseCleanup.resolve();
      await capture;
    }
    expect((await service.queries.getDetail(run.id)).run.status).toBe('FAILED');
  });
});
