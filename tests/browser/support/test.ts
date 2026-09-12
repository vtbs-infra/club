import { resolve } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { buildHttpApp } from '../../../src/server/http-app.js';

export const TEST_NOW = new Date('2026-07-30T08:00:00.000Z');

interface BrowserWorkerFixtures {
  readonly appUrl: string;
}

interface BrowserTestFixtures {
  readonly defaultAppearance: void;
}

export const test = base.extend<BrowserTestFixtures, BrowserWorkerFixtures>({
  defaultAppearance: [
    async ({ page }, provide) => {
      await page.route('**/api/v1/appearance', (route) =>
        route.fulfill({ json: { themePreset: 'moe' } }),
      );
      await provide();
    },
    { auto: true },
  ],
  appUrl: [
    // Playwright requires fixture dependencies to use an object-destructuring pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      const app = await buildHttpApp({
        config: { nodeEnv: 'production', logLevel: 'silent', trustProxy: false },
        webRoot: resolve('dist/web'),
      });

      try {
        await provide(await app.listen({ host: '127.0.0.1', port: 0 }));
      } finally {
        await app.close();
      }
    },
    { scope: 'worker' },
  ],
});

export async function freezeBrowserTime(page: Page): Promise<void> {
  await page.clock.setFixedTime(TEST_NOW);
}

export { expect };
