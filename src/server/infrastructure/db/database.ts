import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface DatabaseService {
  readonly orm: PostgresJsDatabase;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseService {
  const client = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 10,
  });
  const orm = drizzle(client);

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
