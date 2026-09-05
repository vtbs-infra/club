import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import type { AppDatabase } from '../../infrastructure/db/database.js';
import { databaseWriteBatches } from '../../infrastructure/db/write-batches.js';
import {
  giftOrderItems,
  giftOrders,
  giftPackages,
  giftReleases,
  giftTierRules,
  snapshotAttemptMembers,
  snapshotRuns,
  type GuardTier,
} from '../../infrastructure/db/schema/index.js';

const TIERS = ['CAPTAIN', 'ADMIRAL', 'GOVERNOR'] as const;
const TIER_INDEX: Readonly<Record<GuardTier, number>> = {
  CAPTAIN: 0,
  ADMIRAL: 1,
  GOVERNOR: 2,
};

export class GiftEligibilityService {
  public async reconcileSnapshot(runId: string, executor: AppDatabase): Promise<number> {
    const [run] = await executor
      .select({
        creatorId: snapshotRuns.creatorId,
        periodStart: snapshotRuns.periodStart,
        status: snapshotRuns.status,
      })
      .from(snapshotRuns)
      .where(eq(snapshotRuns.id, runId))
      .limit(1);
    if (!run || run.status !== 'FINALIZED') return 0;
    const [release] = await executor
      .select({ id: giftReleases.id })
      .from(giftReleases)
      .where(
        and(
          eq(giftReleases.creatorId, run.creatorId),
          eq(giftReleases.eligibilityMonth, run.periodStart),
          eq(giftReleases.status, 'PUBLISHED'),
        ),
      )
      .limit(1);
    return release ? this.reconcileRelease(release.id, executor) : 0;
  }

  public async reconcileRelease(releaseId: string, executor: AppDatabase): Promise<number> {
    const [release] = await executor
      .select()
      .from(giftReleases)
      .where(eq(giftReleases.id, releaseId))
      .limit(1)
      .for('update');
    if (!release || release.status !== 'PUBLISHED') return 0;
    const [run] = await executor
      .select({ acceptedAttemptId: snapshotRuns.acceptedAttemptId })
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, release.creatorId),
          eq(snapshotRuns.periodStart, release.eligibilityMonth),
          eq(snapshotRuns.status, 'FINALIZED'),
        ),
      )
      .limit(1);
    if (!run?.acceptedAttemptId) return 0;
    const members = await executor
      .select()
      .from(snapshotAttemptMembers)
      .where(eq(snapshotAttemptMembers.snapshotAttemptId, run.acceptedAttemptId));
    if (members.length === 0) return 0;

    const packages = await executor
      .select()
      .from(giftPackages)
      .where(eq(giftPackages.giftReleaseId, release.id))
      .orderBy(asc(giftPackages.sortOrder));
    const rules = await executor
      .select()
      .from(giftTierRules)
      .where(eq(giftTierRules.giftReleaseId, release.id));
    const packageById = new Map(packages.map((package_) => [package_.id, package_]));
    const ruleByTier = new Map(
      rules.map((rule) => [rule.tier as GuardTier, rule.giftPackageId] as const),
    );
    let insertedCount = 0;
    for (const memberBatch of databaseWriteBatches(members)) {
      const memberById = new Map(memberBatch.map((member) => [member.id, member] as const));
      const candidates = memberBatch.map((member) => {
        const id = randomUUID();
        return {
          biliDisplayName: member.displayNameAtCapture,
          biliUid: member.biliUid,
          creatorId: release.creatorId,
          giftReleaseId: release.id,
          id,
          orderNumber: `G${release.eligibilityMonth.slice(0, 7).replace('-', '')}-${id
            .replaceAll('-', '')
            .toUpperCase()}`,
          snapshotMemberId: member.id,
          tier: member.tier,
          userId: null,
        };
      });
      const inserted = await executor
        .insert(giftOrders)
        .values(candidates)
        .onConflictDoNothing({
          target: [giftOrders.giftReleaseId, giftOrders.snapshotMemberId],
        })
        .returning({
          id: giftOrders.id,
          snapshotMemberId: giftOrders.snapshotMemberId,
        });
      insertedCount += inserted.length;
      const orderItems = inserted.flatMap((order) => {
        const member = memberById.get(order.snapshotMemberId);
        if (!member) throw new Error('Inserted gift order lost its snapshot member.');
        const tier = member.tier as GuardTier;
        const eligibleTiers =
          release.fulfillmentMode === 'CUMULATIVE' ? TIERS.slice(0, TIER_INDEX[tier] + 1) : [tier];
        const eligiblePackageIds = [
          ...new Set(
            eligibleTiers.map((eligibleTier) => {
              const packageId = ruleByTier.get(eligibleTier);
              if (!packageId) throw new Error('Published release is missing a tier rule.');
              return packageId;
            }),
          ),
        ];
        return eligiblePackageIds.map((giftPackageId, index) => {
          if (!packageById.has(giftPackageId)) {
            throw new Error('Published release contains an invalid tier package.');
          }
          return {
            giftOrderId: order.id,
            giftPackageId,
            sortOrder: index,
          };
        });
      });
      for (const batch of databaseWriteBatches(orderItems)) {
        await executor.insert(giftOrderItems).values(batch);
      }
    }
    return insertedCount;
  }
}
