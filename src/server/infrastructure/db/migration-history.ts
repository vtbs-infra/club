import { sql } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import { EXPECTED_SCHEMA_MIGRATIONS } from './schema-version.js';

type MigrationIdentity = {
  readonly createdAt: string;
  readonly hash: string;
};

export async function readMigrationHistory(
  database: Pick<AppDatabase, 'execute'>,
): Promise<MigrationIdentity[] | null> {
  const [journal] = await database.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!journal?.exists) return null;
  const rows = await database.execute<MigrationIdentity>(sql`
    select created_at::text as "createdAt", hash
    from drizzle.__drizzle_migrations
    order by id
  `);
  return [...rows];
}

/** Deployment accepts an exact prefix; a running application requires the complete history. */
export function assertMigrationHistory(
  applied: readonly MigrationIdentity[] | null,
  { allowPrefix = false }: { readonly allowPrefix?: boolean } = {},
): void {
  if (
    applied === null ||
    applied.length > EXPECTED_SCHEMA_MIGRATIONS.length ||
    (!allowPrefix && applied.length !== EXPECTED_SCHEMA_MIGRATIONS.length) ||
    applied.some(
      (migration, index) =>
        migration.createdAt !== EXPECTED_SCHEMA_MIGRATIONS[index]?.createdAt ||
        migration.hash !== EXPECTED_SCHEMA_MIGRATIONS[index]?.hash,
    )
  ) {
    throw new Error('Database schema migration identity does not match this application.');
  }
}
