import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { schema, type AppSchema } from './schema/index.js';
import { assertMigrationHistory, readMigrationHistory } from './migration-history.js';

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
      assertMigrationHistory(await readMigrationHistory(orm));
    },
    async ping() {
      await client`select 1`;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
