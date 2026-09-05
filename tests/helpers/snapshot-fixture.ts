import { eq } from 'drizzle-orm';

import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotRuns,
  type GuardTier,
} from '../../src/server/infrastructure/db/schema/index.js';
import { databaseWriteBatches } from '../../src/server/infrastructure/db/write-batches.js';

// Supplies already captured evidence; source parsing/capture is tested separately.
export async function insertReadySnapshot(
  database: DatabaseService,
  input: {
    readonly creatorId: string;
    readonly periodStart: string;
    readonly members: readonly { readonly biliUid: string; readonly tier: GuardTier }[];
  },
) {
  return database.orm.transaction(async (transaction) => {
    const now = new Date();
    const [run] = await transaction
      .insert(snapshotRuns)
      .values({
        creatorId: input.creatorId,
        creatorBilibiliUid: '910001',
        creatorRoomId: '810001',
        periodStart: input.periodStart,
        cutoffTimezone: 'Asia/Shanghai',
        scheduledCutoffAt: now,
        onTimeWindowEndAt: new Date(now.getTime() + 600_000),
        status: 'READY',
      })
      .returning();
    const [attempt] = await transaction
      .insert(snapshotAttempts)
      .values({
        snapshotRunId: run!.id,
        attemptNumber: 1,
        schedulerStartedAt: now,
        captureStartedAt: now,
        punctuality: 'ON_TIME',
        sourceName: 'fixture',
        sourceVersion: '1',
      })
      .returning();
    for (const batch of databaseWriteBatches(
      input.members.map((member, index) => ({
        ...member,
        displayNameAtCapture: `Member ${member.biliUid}`,
        rawTier: member.tier,
        snapshotAttemptId: attempt!.id,
        sourcePage: Math.floor(index / 30) + 1,
        sourcePosition: index + 1,
      })),
    )) {
      await transaction.insert(snapshotAttemptMembers).values(batch);
    }
    await transaction
      .update(snapshotAttempts)
      .set({
        captureCompletedAt: now,
        consistencyStatus: 'CONSISTENT',
        declaredTotal: input.members.length,
        normalizedTotal: input.members.length,
      })
      .where(eq(snapshotAttempts.id, attempt!.id));
    return { run: run!, attemptId: attempt!.id };
  });
}
