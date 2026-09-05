import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { SystemClock } from '../../src/server/infrastructure/clock/clock.js';
import {
  giftOrders,
  snapshotAttemptMembers,
  snapshotRuns,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { FakeGuardRosterSource } from '../../src/server/modules/bilibili/fake-guard-roster-source.js';
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { insertReadySnapshot } from '../helpers/snapshot-fixture.js';

integration('publication and roster finalization coordination', () => {
  let fixture: IntegrationDatabase;
  let storage: TemporaryStorage;
  let creatorId: string;
  let actorUserId: string;
  let releases: GiftReleaseService;
  let snapshots: SnapshotService;
  const context = () => ({ actorUserId, ipAddress: '127.0.0.1', requestId: 'concurrency-test' });

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('eligibility_concurrency');
    storage = await createTemporaryStorage();
    const [user] = await fixture.database.orm
      .insert(users)
      .values({
        email: 'eligibility@example.test',
        name: 'Eligibility creator',
        role: 'CREATOR',
      })
      .returning();
    actorUserId = user!.id;
    creatorId = (
      await insertTestCreator(fixture.database, {
        userId: actorUserId,
        bilibiliUid: '910001',
        roomId: '810001',
        displayName: 'Creator',
      })
    ).id;
    const clock = new SystemClock();
    releases = new GiftReleaseService(fixture.database, clock);
    snapshots = new SnapshotService(
      fixture.database,
      storage.driver,
      new FakeGuardRosterSource(),
      clock,
      releases.eligibility,
    );
  });

  afterAll(async () => {
    await storage?.cleanup();
    await fixture?.cleanup();
  });

  it.each(['publication', 'finalization'] as const)(
    'serializes %s before the competing transaction commits',
    async (first) => {
      const periodStart = first === 'publication' ? '2026-01-01' : '2026-02-01';
      const { run } = await insertReadySnapshot(fixture.database, {
        creatorId,
        periodStart,
        members: [{ biliUid: '100001', tier: 'GOVERNOR' }],
      });
      const draft = createReleaseDraft(periodStart);
      const release = await releases.create(creatorId, draft, context());
      let enter!: () => void;
      let resume!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const method = first === 'publication' ? 'reconcileRelease' : 'reconcileSnapshot';
      const original = releases.eligibility[method].bind(releases.eligibility);
      const spy = vi.spyOn(releases.eligibility, method).mockImplementationOnce(async (...args) => {
        const count = await original(...args);
        enter();
        await gate;
        return count;
      });
      const publish = () =>
        releases.publish(
          creatorId,
          release.id,
          { ...draft, expectedVersion: release.version },
          context(),
        );
      const finalize = () => snapshots.finalizeReady(run.id);
      const leader = first === 'publication' ? publish() : finalize();
      await entered;
      const follower = first === 'publication' ? finalize() : publish();
      try {
        await vi.waitFor(async () => {
          const [waiting] = await fixture.database.orm.execute<{ value: number }>(sql`
          select count(*)::int as value from pg_stat_activity
          where datname = current_database() and wait_event = 'advisory'
        `);
          expect(waiting?.value).toBeGreaterThan(0);
        });
      } finally {
        resume();
        await Promise.all([leader, follower]);
        spy.mockRestore();
      }
      await Promise.all([publish(), finalize(), finalize()]);
      expect(
        await fixture.database.orm
          .select({ value: count() })
          .from(giftOrders)
          .where(eq(giftOrders.giftReleaseId, release.id)),
      ).toEqual([{ value: 1 }]);
    },
  );

  it('seals completed candidate collections and rejects accepting another run or an unfinished attempt', async () => {
    const a = await insertReadySnapshot(fixture.database, {
      creatorId,
      periodStart: '2026-03-01',
      members: [],
    });
    const b = await insertReadySnapshot(fixture.database, {
      creatorId,
      periodStart: '2026-04-01',
      members: [],
    });
    await expect(
      fixture.database.orm.insert(snapshotAttemptMembers).values({
        snapshotAttemptId: a.attemptId,
        biliUid: '100002',
        displayNameAtCapture: 'Injected',
        tier: 'CAPTAIN',
        rawTier: '3',
        sourcePage: 1,
        sourcePosition: 1,
      }),
    ).rejects.toThrow();
    await expect(
      fixture.database.orm
        .update(snapshotRuns)
        .set({
          status: 'FINALIZED',
          finalizedAt: new Date(),
          acceptedAttemptId: a.attemptId,
        })
        .where(eq(snapshotRuns.id, b.run.id)),
    ).rejects.toThrow();
    await snapshots.finalizeReady(a.run.id);
    await expect(
      fixture.database.orm
        .update(snapshotRuns)
        .set({ acceptedAttemptId: b.attemptId })
        .where(eq(snapshotRuns.id, a.run.id)),
    ).rejects.toThrow();
  });
});
