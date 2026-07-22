import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { buildApp } from '../../src/server/app.js';
import type { AppDatabase, DatabaseService } from '../../src/server/infrastructure/db/database.js';
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
    orm: {} as AppDatabase,
    ping: () => Promise.resolve(),
  };
  storage = await createTemporaryStorage();
  app = await buildApp({
    config: createTestConfig({ nodeEnv: 'production' }),
    database,
    serveStatic: true,
    startBackground: false,
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
  await page.getByRole('link', { name: 'Create account' }).first().click();
  await expect(page.getByRole('heading', { name: 'Join your community team.' })).toBeVisible();
  await expect(page.getByLabel('Display name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();

  const live = await request.get('/health/live');
  expect(live.ok()).toBe(true);
  await expect(live.json()).resolves.toMatchObject({ status: 'ok', version: '0.1.0' });
});
