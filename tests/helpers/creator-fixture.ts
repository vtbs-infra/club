import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { creators } from '../../src/server/infrastructure/db/schema/index.js';

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
  const [creator] = await database.orm
    .insert(creators)
    .values({
      bilibiliUid: input.bilibiliUid,
      displayName: input.displayName,
      monthlySyncEnabled: input.monthlySyncEnabled ?? true,
      roomId: input.roomId,
      timezone: input.timezone ?? 'Asia/Shanghai',
      userId: input.userId,
    })
    .returning();
  return creator!;
}
