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
let baseUrl: string;
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
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
});

test.afterAll(async () => {
  await app.close();
  await storage.cleanup();
});

test('serves the production React shell and liveness API', async ({ page, request }) => {
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: '舰长礼物，从资格确认到收货，一处完成。' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '创建账号' }).first().click();
  await expect(page.getByRole('heading', { name: '创建你的 Club 账号' })).toBeVisible();
  await expect(page.getByLabel('昵称')).toBeVisible();
  await expect(page.getByLabel('邮箱')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();

  const live = await request.get(`${baseUrl}/health/live`);
  expect(live.ok()).toBe(true);
  await expect(live.json()).resolves.toMatchObject({ status: 'ok', version: '0.1.0' });
});

test('lands a recipient on the fixed mobile dashboard without a workspace picker', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.route('**/api/v1/me**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname === '/api/v1/me') {
      body = {
        creator: null,
        user: {
          email: 'viewer@example.com',
          id: '00000000-0000-4000-8000-000000000001',
          image: null,
          name: '测试用户',
          role: 'USER',
        },
      };
    } else if (url.pathname === '/api/v1/me/gifts') {
      body = [
        {
          biliDisplayName: '测试舰长',
          biliUid: '10001',
          cancelledAt: null,
          completedAt: null,
          creator: {
            displayName: '测试主播',
            id: '00000000-0000-4000-8000-000000000002',
          },
          expiresAt: '2026-08-31T15:59:00.000Z',
          id: '00000000-0000-4000-8000-000000000003',
          items: [
            {
              description: '',
              id: '00000000-0000-4000-8000-000000000004',
              items: [{ description: '', name: '纪念徽章', quantity: 1 }],
              name: '舰长礼物',
            },
          ],
          orderNumber: 'G202607-TEST0001',
          processingAt: null,
          release: {
            claimDeadlineAt: '2026-08-31T15:59:00.000Z',
            claimStartAt: '2026-07-01T00:00:00.000Z',
            coverImageUrl: null,
            description: '七月舰长纪念礼物',
            eligibilityMonth: '2026-07-01',
            formFields: [],
            id: '00000000-0000-4000-8000-000000000005',
            title: '七月舰长礼物',
          },
          shipments: [],
          shippedAt: null,
          status: 'CLAIMABLE',
          submittedAt: null,
          tier: 'CAPTAIN',
          updatedAt: '2026-07-29T00:00:00.000Z',
          userId: null,
          version: 1,
        },
      ];
    } else if (url.pathname === '/api/v1/me/announcements') {
      body = [
        {
          body: '新版 Club 已上线。',
          createdAt: '2026-07-29T00:00:00.000Z',
          expiresAt: null,
          id: '00000000-0000-4000-8000-000000000006',
          pinned: true,
          publishedAt: '2026-07-29T00:00:00.000Z',
          read: false,
          scope: 'PLATFORM',
          severity: 'INFO',
          title: '欢迎使用 Club',
          version: 1,
        },
      ];
    } else if (url.pathname === '/api/v1/me/bilibili-binding') {
      body = {
        biliDisplayName: '测试舰长',
        biliUid: '10001',
        boundAt: '2026-07-29T00:00:00.000Z',
        id: '00000000-0000-4000-8000-000000000007',
      };
    } else if (url.pathname === '/api/v1/me/addresses') {
      body = [];
    } else {
      await route.continue();
      return;
    }
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto(`${baseUrl}/dashboard`);
  await expect(page.getByRole('heading', { name: '欢迎回来，测试用户！' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '近期资讯' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '七月舰长礼物' })).toBeVisible();
  await expect(page.getByText('先保存一个收货地址')).toBeVisible();
  await expect(page.getByText('选择组织')).toHaveCount(0);
});
