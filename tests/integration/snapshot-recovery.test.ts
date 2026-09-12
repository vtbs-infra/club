import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  snapshotAttempts,
  snapshotRuns,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { GiftEligibilityService } from '../../src/server/modules/gifts/eligibility-service.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';
import { insertScheduledSnapshot } from '../helpers/snapshot-fixture.js';
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
  let reviewerId: string;
  const services: SnapshotService[] = [];
  const clock = { now: () => new Date('2026-08-01T00:00:00.000Z') };

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('snapshot_recovery');
    storage = await createTemporaryStorage();
  });
  beforeEach(async () => {
    await fixture.database.orm.execute(sql`truncate users cascade`);
    sequence = 0;
    reviewerId = randomUUID();
    await fixture.database.orm
      .insert(users)
      .values({ id: reviewerId, username: 'reviewer', name: 'Reviewer', role: 'PLATFORM_ADMIN' });
  });
  afterEach(async () => {
    for (const service of services) service.beginShutdown();
    await Promise.all(services.splice(0).map((service) => service.waitForIdle()));
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await storage?.cleanup();
    await fixture?.cleanup();
  });

  async function setup(maxDurationMs?: number) {
    const userId = randomUUID();
    sequence += 1;
    await fixture.database.orm.insert(users).values({
      id: userId,
      username: `creator_${sequence}`,
      bilibiliUid: String(50000 + sequence),
      name: 'Creator',
      role: 'CREATOR',
    });
    const creator = await insertTestCreator(fixture.database, {
      userId,
      bilibiliUid: String(50000 + sequence),
      roomId: String(60000 + sequence),
      displayName: 'Creator',
    });
    const run = await insertScheduledSnapshot(fixture.database, creator.id);
    const source = new FakeGuardRosterSource();
    const service = new SnapshotService(
      fixture.database,
      storage.driver,
      source,
      clock,
      new GiftEligibilityService(),
      maxDurationMs,
    );
    services.push(service);
    return { context: { actorUserId: reviewerId }, run, source, service };
  }

  it('recovers an abandoned attempt without trying the source again', async () => {
    const { run, service, source } = await setup();
    await fixture.database.orm.insert(snapshotAttempts).values({
      snapshotRunId: run.id,
      attemptNumber: 1,
      schedulerStartedAt: clock.now(),
      sourceName: 'interrupted',
      sourceVersion: '1',
    });
    await fixture.database.orm
      .update(snapshotRuns)
      .set({ status: 'RUNNING' })
      .where(eq(snapshotRuns.id, run.id));
    const fetch = vi.spyOn(source, 'fetchPage');
    await service.runDue();
    const detail = await service.queries.getDetail(run.id);
    expect(detail.run.status).toBe('FAILED');
    expect(detail.attempts[0]?.failureCode).toBe('PROCESS_INTERRUPTED');
    expect(fetch).not.toHaveBeenCalled();
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

  it.each(['shutdown', 'timeout'] as const)(
    'seals a cancelled capture before %s completes',
    async (reason) => {
      const { run, service, source } = await setup(reason === 'timeout' ? 10 : undefined);
      const entered = Promise.withResolvers<void>();
      vi.spyOn(source, 'fetchPage').mockImplementation(
        (input) =>
          new Promise((_resolve, reject) => {
            const abort = () =>
              reject(
                input.signal.reason instanceof Error
                  ? input.signal.reason
                  : new Error('Capture cancelled'),
              );
            if (input.signal.aborted) abort();
            else input.signal.addEventListener('abort', abort, { once: true });
            entered.resolve();
          }),
      );
      const capture = service.capture(run.id);
      if (reason === 'shutdown') {
        await entered.promise;
        await expect(service.capture(run.id)).rejects.toMatchObject({
          code: 'SNAPSHOT_CAPTURE_NOT_ALLOWED',
        });
        service.beginShutdown();
        await service.waitForIdle();
      }
      await capture;
      const detail = await service.queries.getDetail(run.id);
      expect(detail.run.status).toBe('FAILED');
      expect(detail.attempts[0]?.failureCode).toBe(
        reason === 'shutdown' ? 'PROCESS_SHUTDOWN' : 'CAPTURE_TIMEOUT',
      );
    },
  );

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
});
