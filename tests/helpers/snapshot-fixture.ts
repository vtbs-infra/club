import { eq } from 'drizzle-orm';

import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotRuns,
  creators,
  type GuardTier,
} from '../../src/server/infrastructure/db/schema/index.js';
import { databaseWriteBatches } from '../../src/server/infrastructure/db/write-batches.js';
import { calculateMonthlyCutoff } from '../../src/server/modules/snapshots/month-end.js';

export async function insertScheduledSnapshot(
  database: DatabaseService,
  creatorId: string,
  periodStart = '2026-07-01',
) {
  const [creator] = await database.orm.select().from(creators).where(eq(creators.id, creatorId));
  if (!creator) throw new Error('Snapshot fixture requires a creator.');
  const [run] = await database.orm
    .insert(snapshotRuns)
    .values({
      creatorId,
      creatorBilibiliUid: creator.bilibiliUid,
      creatorRoomId: creator.roomId,
      ...calculateMonthlyCutoff(periodStart, creator.timezone),
    })
    .returning();
  return run!;
}

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
    const [creator] = await transaction
      .select()
      .from(creators)
      .where(eq(creators.id, input.creatorId));
    if (!creator) throw new Error('Snapshot fixture requires a creator.');
    const cutoff = calculateMonthlyCutoff(input.periodStart, creator.timezone);
    const now = cutoff.scheduledCutoffAt;
    const [run] = await transaction
      .insert(snapshotRuns)
      .values({
        creatorId: input.creatorId,
        creatorBilibiliUid: creator.bilibiliUid,
        creatorRoomId: creator.roomId,
        ...cutoff,
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

/** Supplies an accepted roster to tests whose subject starts after capture and review. */
export async function insertFinalizedSnapshot(
  database: DatabaseService,
  input: Parameters<typeof insertReadySnapshot>[1],
) {
  const { run, attemptId } = await insertReadySnapshot(database, input);
  const [finalized] = await database.orm
    .update(snapshotRuns)
    .set({
      acceptedAttemptId: attemptId,
      finalizedAt: new Date(),
      status: 'FINALIZED',
    })
    .where(eq(snapshotRuns.id, run.id))
    .returning();
  return finalized!;
}
