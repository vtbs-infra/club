import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  creators,
  entitlements,
  giftCampaigns,
  giftPackages,
  giftTierRules,
  organizationMembers,
  organizations,
  snapshotRuns,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import {
  buildFakeRosterScenario,
  FakeGuardRosterSource,
} from '../../src/server/modules/bilibili/fake-guard-roster-source.js';
import { CampaignService } from '../../src/server/modules/campaigns/campaign-service.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

class MutableClock implements Clock {
  public constructor(public current: Date) {}
  public now() {
    return new Date(this.current);
  }
}

integration('gift campaigns and entitlement reconciliation', () => {
  let database: DatabaseService;
  let storage: TemporaryStorage;
  let campaigns: CampaignService;
  let organizationId: string;
  let ownerId: string;
  const creatorIds: string[] = [];
  const clock = new MutableClock(new Date('2026-01-31T15:59:00.000Z'));

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    storage = await createTemporaryStorage();
    campaigns = new CampaignService(database, clock);
    await database.orm.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        entitlements,
        gift_tier_rules,
        gift_package_items,
        gift_packages,
        gift_campaigns,
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
      .values({ email: 'campaign-owner@example.com', name: 'Campaign Owner' })
      .returning({ id: users.id });
    ownerId = owner!.id;
    const [organization] = await database.orm
      .insert(organizations)
      .values({ name: 'Campaign Org', slug: 'campaign-org' })
      .returning({ id: organizations.id });
    organizationId = organization!.id;
    await database.orm.insert(organizationMembers).values({
      organizationId,
      role: 'OWNER',
      userId: ownerId,
    });
    for (let index = 0; index < 2; index += 1) {
      const [creator] = await database.orm
        .insert(creators)
        .values({
          bilibiliUid: `9900${index}`,
          displayName: `Campaign Creator ${index}`,
          organizationId,
          roomId: `8800${index}`,
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

  async function configuredCampaign(creatorId: string) {
    const draft = await campaigns.create(
      organizationId,
      {
        claimDeadlineAt: new Date('2026-03-01T00:00:00.000Z'),
        claimFormSchema: [
          {
            key: 'size',
            label: 'Size',
            options: ['S', 'M', 'L'],
            required: true,
            type: 'SELECT',
          },
        ],
        claimStartAt: new Date('2026-02-01T00:00:00.000Z'),
        creatorId,
        description: 'January guard gift',
        fulfillmentMode: 'HIGHEST_ONLY',
        periodStart: '2026-01-01',
        title: 'January Gift',
      },
      { actorUserId: ownerId, requestId: 'create' },
    );
    await campaigns.update(
      draft.id,
      {
        composition: {
          packages: [
            {
              description: '',
              items: [{ description: '', name: 'Captain badge', quantity: 1 }],
              key: 'captain',
              name: 'Captain pack',
            },
            {
              description: '',
              items: [{ description: '', name: 'Admiral badge', quantity: 1 }],
              key: 'admiral',
              name: 'Admiral pack',
            },
            {
              description: '',
              items: [{ description: '', name: 'Governor badge', quantity: 1 }],
              key: 'governor',
              name: 'Governor pack',
            },
          ],
          tierRules: [
            { packageKey: 'captain', tier: 'CAPTAIN' },
            { packageKey: 'admiral', tier: 'ADMIRAL' },
            { packageKey: 'governor', tier: 'GOVERNOR' },
          ],
        },
      },
      { actorUserId: ownerId, requestId: 'compose' },
    );
    return draft.id;
  }

  async function finalizeThroughSnapshot(creatorId: string) {
    const [creator] = await database.orm.select().from(creators).where(eq(creators.id, creatorId));
    const [run] = await database.orm
      .insert(snapshotRuns)
      .values({
        creatorBilibiliUid: creator!.bilibiliUid,
        creatorId,
        creatorRoomId: creator!.roomId,
        cutoffTimezone: 'Asia/Shanghai',
        onTimeWindowEndAt: new Date('2026-01-31T16:00:00.000Z'),
        organizationId,
        periodStart: '2026-01-01',
        scheduledCutoffAt: new Date('2026-01-31T15:59:00.000Z'),
      })
      .returning();
    const source = new FakeGuardRosterSource();
    source.setScenario(
      buildFakeRosterScenario([
        {
          biliUid: 'gift-uid-captain',
          displayName: 'Captain',
          rawTier: '3',
          sourcePosition: 1,
          tier: 'CAPTAIN',
        },
        {
          biliUid: 'gift-uid-admiral',
          displayName: 'Admiral',
          rawTier: '2',
          sourcePosition: 2,
          tier: 'ADMIRAL',
        },
        {
          biliUid: 'gift-uid-governor',
          displayName: 'Governor',
          rawTier: '1',
          sourcePosition: 3,
          tier: 'GOVERNOR',
        },
      ]),
    );
    const snapshots = new SnapshotService(
      database,
      storage.driver,
      source,
      clock,
      120_000,
      (runId, executor) => campaigns.reconcileSnapshot(runId, executor),
    );
    await snapshots.capture(run!.id);
    return run!.id;
  }

  async function entitlementSignature(campaignId: string) {
    return database.orm
      .select({
        biliUid: entitlements.biliUid,
        packageName: giftPackages.name,
        tier: entitlements.tier,
      })
      .from(entitlements)
      .innerJoin(giftPackages, eq(giftPackages.id, entitlements.giftPackageId))
      .where(eq(entitlements.campaignId, campaignId))
      .orderBy(asc(entitlements.biliUid));
  }

  it('produces identical entitlements whether publish or snapshot happens first', async () => {
    const afterSnapshotCampaign = await configuredCampaign(creatorIds[0]!);
    await finalizeThroughSnapshot(creatorIds[0]!);
    await campaigns.publish(afterSnapshotCampaign, {
      actorUserId: ownerId,
      requestId: 'publish-after',
    });

    const beforeSnapshotCampaign = await configuredCampaign(creatorIds[1]!);
    const publishedBefore = await campaigns.publish(beforeSnapshotCampaign, {
      actorUserId: ownerId,
      requestId: 'publish-before',
    });
    expect(publishedBefore.progress.total).toBe(0);
    await finalizeThroughSnapshot(creatorIds[1]!);

    const afterSignature = await entitlementSignature(afterSnapshotCampaign);
    const beforeSignature = await entitlementSignature(beforeSnapshotCampaign);
    expect(beforeSignature).toEqual(afterSignature);
    expect(beforeSignature).toHaveLength(3);
    expect(await campaigns.reconcileCampaign(beforeSnapshotCampaign)).toBe(0);
    expect(
      await campaigns.reconcileSnapshot(
        (
          await database.orm
            .select({ id: snapshotRuns.id })
            .from(snapshotRuns)
            .where(eq(snapshotRuns.creatorId, creatorIds[1]!))
        )[0]!.id,
      ),
    ).toBe(0);
  });

  it('freezes published rules and preserves entitlement evidence in PostgreSQL', async () => {
    const campaignId = (
      await database.orm
        .select({ id: giftCampaigns.id })
        .from(giftCampaigns)
        .where(eq(giftCampaigns.creatorId, creatorIds[0]!))
    )[0]!.id;
    const [rule] = await database.orm
      .select()
      .from(giftTierRules)
      .where(eq(giftTierRules.campaignId, campaignId));
    await expect(
      database.orm
        .update(giftTierRules)
        .set({ tier: 'GOVERNOR' })
        .where(eq(giftTierRules.id, rule!.id)),
    ).rejects.toThrow();
    await expect(
      database.orm
        .update(giftCampaigns)
        .set({ claimFormSchema: [] })
        .where(eq(giftCampaigns.id, campaignId)),
    ).rejects.toThrow();
    const [entitlement] = await database.orm
      .select()
      .from(entitlements)
      .where(eq(entitlements.campaignId, campaignId));
    await expect(
      database.orm.delete(entitlements).where(eq(entitlements.id, entitlement!.id)),
    ).rejects.toThrow();
  });

  it('matches historical entitlements through a later active binding and audits revocation', async () => {
    const [room] = await database.orm
      .insert(verificationRooms)
      .values({ biliOwnerUid: '123', biliRoomId: '456', displayName: 'Verification' })
      .returning({ id: verificationRooms.id });
    const [challenge] = await database.orm
      .insert(bindingChallenges)
      .values({
        codeDigest: 'digest',
        expiresAt: new Date('2026-02-01T00:10:00.000Z'),
        status: 'CONSUMED',
        userId: ownerId,
        verificationRoomId: room!.id,
      })
      .returning({ id: bindingChallenges.id });
    await database.orm.insert(bilibiliBindings).values({
      biliUid: 'gift-uid-governor',
      challengeId: challenge!.id,
      userId: ownerId,
    });
    const gifts = await campaigns.listForUser(ownerId);
    expect(gifts).toHaveLength(2);
    expect(gifts.every((gift) => gift.entitlements.length === 1)).toBe(true);
    expect(await campaigns.getForUser(ownerId, gifts[0]!.campaign.id)).toMatchObject({
      campaign: { id: gifts[0]!.campaign.id },
    });

    const [entitlement] = await database.orm
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.campaignId, gifts[0]!.campaign.id),
          eq(entitlements.biliUid, 'gift-uid-governor'),
        ),
      );
    await campaigns.revoke(entitlement!.id, 'Recipient was disqualified', {
      actorUserId: ownerId,
      requestId: 'revoke',
    });
    const [audit] = await database.orm
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'entitlement.revoked'), eq(auditLogs.targetId, entitlement!.id)),
      );
    expect(audit).toMatchObject({ reason: 'Recipient was disqualified' });
    const refreshedGift = (await campaigns.listForUser(ownerId)).find(
      (gift) => gift.campaign.id === gifts[0]!.campaign.id,
    )!;
    const refreshedEntitlement = refreshedGift.entitlements.find(
      (candidate) => (candidate as { id: string }).id === entitlement!.id,
    ) as {
      revokedAt: Date | null;
    };
    expect(refreshedEntitlement.revokedAt).toBeInstanceOf(Date);
  });
});
