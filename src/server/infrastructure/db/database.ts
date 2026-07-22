import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { schema, type AppSchema } from './schema.js';

export type AppDatabase = PostgresJsDatabase<AppSchema>;

export interface DatabaseService {
  readonly orm: AppDatabase;
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
    async ping() {
      await client`select 1`;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
