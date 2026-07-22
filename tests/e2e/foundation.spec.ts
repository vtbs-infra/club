import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createTestConfig } from '../helpers/test-config.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let storage: TemporaryStorage;

test.beforeAll(async () => {
  const database: DatabaseService = {
    close: () => Promise.resolve(),
    orm: {} as PostgresJsDatabase,
    ping: () => Promise.resolve(),
  };
  storage = await createTemporaryStorage();
  app = await buildApp({
    config: createTestConfig({ nodeEnv: 'production' }),
    database,
    serveStatic: true,
    storage: storage.driver,
    webRoot: resolve('dist/web'),
  });
  await app.listen({ host: '127.0.0.1', port: 3000 });
});

test.afterAll(async () => {
  await app.close();
  await storage.cleanup();
});

test('serves the production React shell and liveness API', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Community gifts/ })).toBeVisible();
  await expect(page.getByText('Milestone 0')).toBeVisible();

  const live = await request.get('/health/live');
  expect(live.ok()).toBe(true);
  await expect(live.json()).resolves.toMatchObject({ status: 'ok', version: '0.1.0' });
});
