import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { schema, type AppSchema } from './schema/index.js';
import { EXPECTED_SCHEMA_MIGRATION_TIMESTAMPS } from './schema-version.js';

export type AppDatabase = PostgresJsDatabase<AppSchema>;

export interface DatabaseService {
  readonly orm: AppDatabase;
  checkSchema(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseService {
  const client = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 10,
  });
  const orm = drizzle(client, { schema });

  return {
    orm,
    async checkSchema() {
      const applied = await client<{ createdAt: string }[]>`
        select created_at::text as "createdAt"
        from drizzle.__drizzle_migrations
        order by id
      `;
      if (
        applied.length !== EXPECTED_SCHEMA_MIGRATION_TIMESTAMPS.length ||
        applied.some(
          (migration, index) => migration.createdAt !== EXPECTED_SCHEMA_MIGRATION_TIMESTAMPS[index],
        )
      ) {
        throw new Error('Database schema migration version does not match this application.');
      }
    },
    async ping() {
      await client`select 1`;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
