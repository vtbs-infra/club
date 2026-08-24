import { resolve } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { buildApp } from '../../../src/server/app.js';
import type {
  AppDatabase,
  DatabaseService,
} from '../../../src/server/infrastructure/db/database.js';
import { createTemporaryStorage } from '../../../src/server/infrastructure/storage/temporary-storage.js';
import { createTestConfig } from '../../helpers/test-config.js';

export const TEST_NOW = new Date('2026-07-30T08:00:00.000Z');

interface BrowserWorkerFixtures {
  readonly appUrl: string;
}

export const test = base.extend<Record<never, never>, BrowserWorkerFixtures>({
  appUrl: [
    // Playwright requires fixture dependencies to use an object-destructuring pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      const database: DatabaseService = {
        checkSchema: () => Promise.resolve(),
        close: () => Promise.resolve(),
        orm: {} as AppDatabase,
        ping: () => Promise.resolve(),
      };
      const storage = await createTemporaryStorage();
      const app = await buildApp({
        config: createTestConfig({ nodeEnv: 'production' }),
        database,
        serveStatic: true,
        startBackground: false,
        storage: storage.driver,
        webRoot: resolve('dist/web'),
      });

      try {
        await provide(await app.listen({ host: '127.0.0.1', port: 0 }));
      } finally {
        await app.close();
        await storage.cleanup();
      }
    },
    { scope: 'worker' },
  ],
});

export async function freezeBrowserTime(page: Page): Promise<void> {
  await page.clock.setFixedTime(TEST_NOW);
}

export { expect };
