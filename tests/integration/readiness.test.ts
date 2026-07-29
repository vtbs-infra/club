import { resolve } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration('PostgreSQL readiness', () => {
  let database: DatabaseService;
  let admin: ReturnType<typeof postgres>;
  let databaseName: string;
  let storage: TemporaryStorage;

  beforeAll(async () => {
    const adminUrl = new URL(testDatabaseUrl!);
    adminUrl.pathname = '/postgres';
    admin = postgres(adminUrl.toString(), { max: 1 });
    databaseName = `club_readiness_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await admin.unsafe(`create database "${databaseName}"`);
    const databaseUrl = new URL(testDatabaseUrl!);
    databaseUrl.pathname = `/${databaseName}`;
    database = createDatabase(databaseUrl.toString());
    storage = await createTemporaryStorage();
    await migrateDatabase(database, resolve('migrations'));
  });

  afterAll(async () => {
    await database.close();
    await storage.cleanup();
    await admin.unsafe(`drop database if exists "${databaseName}"`);
    await admin.end();
  });

  it('reports a real PostgreSQL and isolated storage as ready', async () => {
    const app = await buildApp({
      config: createTestConfig({ databaseUrl: 'postgres://unused-by-injected-database' }),
      database,
      storage: storage.driver,
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        checks: {
          database: 'ok',
          runtimes: 'disabled',
          schema: 'ok',
          storage: 'ok',
        },
        status: 'ok',
      });
    } finally {
      await app.close();
    }
  });
});
