import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';

import type { DatabaseService } from './database.js';

export async function migrateDatabase(
  database: DatabaseService,
  migrationsFolder = 'migrations',
): Promise<void> {
  const existing = await database.orm.execute(sql`
    select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') limit 1
  `);
  if (existing.length > 0) {
    try {
      await database.checkSchema();
      return;
    } catch {
      throw new Error(
        'This baseline requires an empty database. Existing databases are not migrated or erased.',
      );
    }
  }
  await migrate(database.orm, { migrationsFolder });
  await database.checkSchema();
}
