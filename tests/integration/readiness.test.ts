import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration('PostgreSQL readiness', () => {
  let database: DatabaseService;
  let storage: TemporaryStorage;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    storage = await createTemporaryStorage();
    await database.ping();
  });

  afterAll(async () => {
    await database.close();
    await storage.cleanup();
  });

  it('reports a real PostgreSQL and isolated storage as ready', async () => {
    const app = await buildApp({
      config: createTestConfig({ databaseUrl: testDatabaseUrl! }),
      database,
      storage: storage.driver,
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        checks: { database: 'ok', storage: 'ok' },
        status: 'ok',
      });
    } finally {
      await app.close();
    }
  });
});
