import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createTestConfig } from '../helpers/test-config.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

integration('PostgreSQL readiness', () => {
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let storage: TemporaryStorage;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('readiness');
    database = integrationDatabase.database;
    storage = await createTemporaryStorage();
  });

  afterAll(async () => {
    await storage.cleanup();
    await integrationDatabase.cleanup();
  });

  it('reports a real PostgreSQL and isolated storage as ready', async () => {
    const app = await buildApp({
      config: createTestConfig({ databaseUrl: integrationDatabase.databaseUrl }),
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
