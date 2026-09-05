import { sql } from 'drizzle-orm';

import type { AppDatabase } from '../../infrastructure/db/database.js';

// Publication and roster finalization must observe each other's committed prerequisite.
// Acquire this transaction lock before locking or changing either business record.
export async function lockEligibilityPeriod(
  transaction: AppDatabase,
  creatorId: string,
  periodStart: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`club:eligibility:${creatorId}:${periodStart}`}, 0))`,
  );
}
