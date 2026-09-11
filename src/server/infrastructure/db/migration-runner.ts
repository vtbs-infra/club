import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';

import type { DatabaseService } from './database.js';
import { assertMigrationHistory, readMigrationHistory } from './migration-history.js';

export async function migrateDatabase(
  database: DatabaseService,
  migrationsFolder = 'migrations',
): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  // Validate the complete SQL artifact before executing any DDL, including pending migrations.
  assertMigrationHistory(
    migrations.map((migration) => ({
      createdAt: String(migration.folderMillis),
      hash: migration.hash,
    })),
  );
  await database.orm.transaction(
    async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext('club:schema-migrations'))`,
      );
      const applied = await readMigrationHistory(transaction);
      if (applied?.length) {
        assertMigrationHistory(applied, { allowPrefix: true });
      } else {
        // An empty Drizzle journal and its owned sequence may remain after an older failed install.
        const existing = await transaction.execute(sql`
        select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname not in ('pg_catalog', 'information_schema')
          and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
          and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
          and c.oid <> coalesce(to_regclass('drizzle.__drizzle_migrations')::oid, 0)
          and not exists (
            select 1 from pg_depend d
            where d.classid = 'pg_class'::regclass and d.objid = c.oid
              and d.refobjid = to_regclass('drizzle.__drizzle_migrations') and d.deptype = 'a'
          )
        limit 1
      `);
        if (existing.length > 0) {
          throw new Error(
            'This baseline requires an empty database. Unrecognized existing databases are not migrated or erased.',
          );
        }
      }

      // Keep admission, Drizzle-compatible journal writes and all pending DDL in one locked transaction.
      await transaction.execute(sql`create schema if not exists drizzle`);
      await transaction.execute(sql`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key, hash text not null, created_at bigint
      )
    `);
      for (const migration of migrations.slice(applied?.length ?? 0)) {
        for (const statement of migration.sql) await transaction.execute(sql.raw(statement));
        await transaction.execute(sql`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})
      `);
      }
      assertMigrationHistory(await readMigrationHistory(transaction));
    },
    { isolationLevel: 'read committed' },
  );
}
