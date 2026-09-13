import { resolve } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { buildHttpApp } from '../../../src/server/http-app.js';

import { mockJson, requestPath } from './api.js';

export const TEST_NOW = new Date('2026-07-30T08:00:00.000Z');

interface BrowserWorkerFixtures {
  readonly appUrl: string;
}

interface BrowserTestFixtures {
  readonly defaultAppearance: void;
}

export const test = base.extend<BrowserTestFixtures, BrowserWorkerFixtures>({
  // Service workers bypass Playwright routing; mocked tests must use the same API boundary.
  serviceWorkers: 'block',
  context: async ({ context }, provide) => {
    const unhandled = new Set<string>();
    // Page handlers run first, including shared defaults and scenario overrides.
    await context.route(
      (url) => /^\/api(?:\/|$)/.test(url.pathname),
      async (route) => {
        const request = route.request();
        unhandled.add(`${request.method()} ${requestPath(request)}`);
        await route.abort('blockedbyclient');
      },
    );
    try {
      await provide(context);
    } finally {
      // Stop pages before checking so late requests cannot escape the assertion.
      await context.close();
      expect([...unhandled], 'API requests without an explicit browser mock').toEqual([]);
    }
  },
  defaultAppearance: [
    async ({ page }, provide) => {
      await mockJson(page, 'GET', '/api/v1/appearance', { themePreset: 'moe' });
      await provide();
    },
    { auto: true },
  ],
  appUrl: [
    // Playwright requires fixture dependencies to use an object-destructuring pattern.
    // oxlint-disable-next-line no-empty-pattern
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
