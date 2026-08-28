import { randomUUID } from 'node:crypto';

import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  bilibiliBindings,
  bindingChallenges,
  creators,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema/index.js';

export async function insertTestBilibiliBinding(
  database: DatabaseService,
  input: {
    readonly biliDisplayName: string;
    readonly biliUid: string;
    readonly userId: string;
  },
) {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const suffix = randomUUID().replaceAll('-', '');
  const [room] = await database.orm
    .insert(verificationRooms)
    .values({ biliRoomId: `7${suffix.slice(0, 15)}`, displayName: 'Fixture Verification Room' })
    .returning({ id: verificationRooms.id });
  const [challenge] = await database.orm
    .insert(bindingChallenges)
    .values({
      codeDigest: suffix.padEnd(64, '0'),
      consumedAt: now,
      consumedEventId: `fixture-${suffix}`,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      status: 'CONSUMED',
      userId: input.userId,
      verificationRoomId: room!.id,
    })
    .returning({ id: bindingChallenges.id });
  const [binding] = await database.orm
    .insert(bilibiliBindings)
    .values({
      biliDisplayName: input.biliDisplayName,
      biliUid: input.biliUid,
      challengeId: challenge!.id,
      userId: input.userId,
    })
    .returning();
  return binding!;
}

export async function insertTestCreator(
  database: DatabaseService,
  input: {
    readonly bilibiliUid: string;
    readonly displayName: string;
    readonly monthlySyncEnabled?: boolean;
    readonly roomId: string;
    readonly timezone?: string;
    readonly userId: string;
  },
) {
  const binding = await insertTestBilibiliBinding(database, {
    biliDisplayName: input.displayName,
    biliUid: input.bilibiliUid,
    userId: input.userId,
  });
  const [creator] = await database.orm
    .insert(creators)
    .values({
      bilibiliUid: input.bilibiliUid,
      bindingId: binding.id,
      displayName: input.displayName,
      monthlySyncEnabled: input.monthlySyncEnabled ?? true,
      roomId: input.roomId,
      timezone: input.timezone ?? 'Asia/Shanghai',
      userId: input.userId,
    })
    .returning();
  return creator!;
}
