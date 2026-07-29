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
    checkSchema: () => Promise.resolve(),
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
  await expect(page.getByRole('heading', { name: '欢迎来到舰长礼物站' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'archive');
  await page.getByRole('button', { name: 'EN' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to the Guard Gift Club' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: '中文' }).click();
  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole('link', { exact: true, name: '登录' })).toBeVisible();
  await page.getByRole('link', { exact: true, name: '注册' }).click();
  await expect(page.getByRole('heading', { name: '开始使用 Club', level: 1 })).toBeVisible();
  await expect(page.getByLabel('昵称')).toBeVisible();
  await expect(page.getByLabel('邮箱')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();

  const live = await request.get(`${baseUrl}/health/live`);
  expect(live.ok()).toBe(true);
  await expect(live.json()).resolves.toMatchObject({ status: 'ok', version: '0.1.0' });
});

test('confirms registration before asking the user to sign in', async ({ page }) => {
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({
      body: JSON.stringify({ user: { id: '00000000-0000-4000-8000-000000000010' } }),
      contentType: 'application/json',
      status: 200,
    }),
  );
  await page.goto(`${baseUrl}/register`);
  await page.getByLabel('昵称').fill('新用户');
  await page.getByLabel('邮箱').fill('new-user@example.com');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('账号已创建，请使用刚才填写的邮箱和密码登录。')).toBeVisible();
  await expect(page.getByLabel('密码')).toHaveValue('');
});

test('clears the credential form when the user signs out', async ({ page }) => {
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({ body: '{}', contentType: 'application/json', status: 200 }),
  );
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({ body: '{}', contentType: 'application/json', status: 200 }),
  );
  await page.route('**/api/v1/me**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body =
      pathname === '/api/v1/me'
        ? {
            creator: null,
            user: {
              email: 'viewer@example.com',
              id: '00000000-0000-4000-8000-000000000011',
              image: null,
              name: '测试用户',
              role: 'USER',
            },
          }
        : pathname === '/api/v1/me/bilibili-binding'
          ? null
          : [];
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('邮箱').fill('viewer@example.com');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: '测试用户的账号菜单' }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('邮箱')).toHaveValue('');
  await expect(page.getByLabel('密码')).toHaveValue('');
});

test('lands a recipient on the mobile dashboard', async ({ page }) => {
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

  const accountTrigger = page.getByRole('button', { name: '测试用户的账号菜单' });
  await accountTrigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '账号', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'B站绑定' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(accountTrigger).toBeFocused();

  await page.goto(`${baseUrl}/gifts`);
  const giftFilters = page.getByRole('group', { name: '按礼物状态筛选' });
  await expect(giftFilters).toBeVisible();
  await expect(giftFilters.getByRole('button', { name: '全部' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await giftFilters.getByRole('button', { name: '待领取' }).click();
  await expect(giftFilters.getByRole('button', { name: '待领取' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: '七月舰长礼物' })).toBeVisible();
});

test('uses the default address and real radio choice when claiming a gift', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const giftOrderId = '00000000-0000-4000-8000-000000000020';
  let submitted = false;
  let submission: Record<string, unknown> | null = null;
  const gift = () => ({
    biliDisplayName: '测试舰长',
    biliUid: '10001',
    cancelledAt: null,
    completedAt: null,
    creator: {
      displayName: '测试主播',
      id: '00000000-0000-4000-8000-000000000021',
    },
    expiresAt: '2026-08-31T15:59:00.000Z',
    id: giftOrderId,
    items: [
      {
        description: '',
        id: '00000000-0000-4000-8000-000000000022',
        items: [{ description: '', name: '纪念徽章', quantity: 1 }],
        name: '舰长礼物',
      },
    ],
    orderNumber: 'G202607-CLAIM001',
    processingAt: null,
    release: {
      claimDeadlineAt: '2026-08-31T15:59:00.000Z',
      claimStartAt: '2026-07-01T00:00:00.000Z',
      coverImageUrl: null,
      description: '默认地址领取测试',
      eligibilityMonth: '2026-07-01',
      formFields: [
        {
          key: 'size',
          label: '尺码',
          options: ['M', 'L'],
          required: true,
          type: 'RADIO',
        },
      ],
      id: '00000000-0000-4000-8000-000000000023',
      title: '七月舰长礼物',
    },
    shipments: [],
    shippedAt: null,
    status: submitted ? 'SUBMITTED' : 'CLAIMABLE',
    submittedAt: submitted ? '2026-07-29T00:00:00.000Z' : null,
    tier: 'CAPTAIN',
    updatedAt: '2026-07-29T00:00:00.000Z',
    userId: submitted ? '00000000-0000-4000-8000-000000000024' : null,
    version: submitted ? 2 : 1,
  });
  const addresses = [
    {
      createdAt: '2026-07-28T00:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000025',
      isDefault: false,
      label: '办公室',
      payload: {
        city: '上海市',
        countryRegion: '中国大陆',
        detailedAddress: '测试路 1 号',
        district: '浦东新区',
        phone: '13800138001',
        postalCode: '200000',
        province: '上海市',
        recipientName: '办公室收件人',
        userNote: '',
      },
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
    {
      createdAt: '2026-07-29T00:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000026',
      isDefault: true,
      label: '家',
      payload: {
        city: '杭州市',
        countryRegion: '中国大陆',
        detailedAddress: '默认路 2 号',
        district: '西湖区',
        phone: '13800138002',
        postalCode: '310000',
        province: '浙江省',
        recipientName: '默认收件人',
        userNote: '',
      },
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
  ];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let body: unknown;
    if (pathname === '/api/v1/me') {
      body = {
        creator: null,
        user: {
          email: 'viewer@example.com',
          id: '00000000-0000-4000-8000-000000000024',
          image: null,
          name: '测试用户',
          role: 'USER',
        },
      };
    } else if (pathname === '/api/v1/me/addresses') {
      body = addresses;
    } else if (pathname === `/api/v1/me/gifts/${giftOrderId}/submit`) {
      submission = request.postDataJSON() as Record<string, unknown>;
      submitted = true;
      body = gift();
    } else if (pathname === `/api/v1/me/gifts/${giftOrderId}`) {
      body = gift();
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

  await page.goto(`${baseUrl}/gifts/${giftOrderId}`);
  const addressRadios = page.getByRole('radio', { name: /办公室|家/ });
  await expect(addressRadios).toHaveCount(2);
  await expect(addressRadios.nth(1)).toBeChecked();
  await expect(page.getByText('默认收件人', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'L' }).check();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认领取礼物' }).click();
  await expect.poll(() => submission).not.toBeNull();
  expect(submission).toEqual({
    addressId: '00000000-0000-4000-8000-000000000026',
    expectedVersion: 1,
    options: { size: 'L' },
  });
  await expect(page.getByRole('heading', { name: '礼物进度' })).toBeVisible();
});

test('publishes the creator current edits without a separate save', async ({ page }) => {
  const releaseId = '00000000-0000-4000-8000-000000000030';
  let publishedInput: Record<string, unknown> | null = null;
  let publishedRelease: Record<string, unknown> | null = null;
  const draft = {
    claimDeadlineAt: '2026-08-31T15:59:00.000Z',
    claimStartAt: '2026-07-01T00:00:00.000Z',
    closedAt: null,
    coverObjectKey: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    description: '尚未保存的说明',
    eligibilityMonth: '2026-07-01',
    formFields: [],
    fulfillmentMode: 'HIGHEST_ONLY',
    id: releaseId,
    packages: [
      {
        description: '',
        id: '00000000-0000-4000-8000-000000000031',
        items: [{ description: '', name: '纪念徽章', quantity: 1 }],
        name: '舰长礼物',
      },
    ],
    publishedAt: null,
    status: 'DRAFT',
    tierPackageIndexes: { ADMIRAL: 0, CAPTAIN: 0, GOVERNOR: 0 },
    title: '旧标题',
    updatedAt: '2026-07-20T00:00:00.000Z',
    version: 3,
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let body: unknown;
    if (pathname === '/api/v1/me') {
      body = {
        creator: {
          active: true,
          bilibiliUid: '90001',
          displayName: '测试主播',
          id: '00000000-0000-4000-8000-000000000032',
          roomId: '80001',
          timezone: 'Asia/Shanghai',
        },
        user: {
          email: 'creator@example.com',
          id: '00000000-0000-4000-8000-000000000033',
          image: null,
          name: '主播账号',
          role: 'CREATOR',
        },
      };
    } else if (pathname === `/api/v1/creator/releases/${releaseId}/publish`) {
      publishedInput = request.postDataJSON() as Record<string, unknown>;
      publishedRelease = {
        ...draft,
        ...(publishedInput ?? {}),
        publishedAt: '2026-07-29T00:00:00.000Z',
        status: 'PUBLISHED',
        updatedAt: '2026-07-29T00:00:00.000Z',
        version: 4,
      };
      body = publishedRelease;
    } else if (pathname === `/api/v1/creator/releases/${releaseId}`) {
      body = publishedRelease ?? draft;
    } else if (pathname === '/api/v1/creator/releases') {
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

  await page.goto(`${baseUrl}/creator/releases/${releaseId}`);
  await page.getByLabel('礼物名称').fill('当前页面的新标题');
  const publishButton = page.getByRole('button', { name: '发布并生成礼物单' }).first();
  await publishButton.click();
  let dialog = page.getByRole('dialog', { name: '确认发布当前内容？' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '返回' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(publishButton).toBeFocused();

  await publishButton.click();
  dialog = page.getByRole('dialog', { name: '确认发布当前内容？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '发布并生成礼物单' }).click();
  await expect.poll(() => publishedInput).not.toBeNull();
  expect(publishedInput).toMatchObject({
    expectedVersion: 3,
    title: '当前页面的新标题',
  });
  await expect(page.getByText('已发布')).toBeVisible();
});

test('keeps admin creation editors visible and focused at 800px', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 800 });
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown;
    if (pathname === '/api/v1/me') {
      body = {
        creator: null,
        user: {
          email: 'admin@example.com',
          id: '00000000-0000-4000-8000-000000000040',
          image: null,
          name: '平台管理员',
          role: 'PLATFORM_ADMIN',
        },
      };
    } else if (pathname === '/api/v1/admin/creators') {
      body = [];
    } else if (pathname === '/api/v1/admin/users') {
      body = [
        {
          email: 'candidate@example.com',
          id: '00000000-0000-4000-8000-000000000041',
          name: '候选主播',
          role: 'USER',
        },
      ];
    } else if (pathname === '/api/v1/admin/verification-rooms') {
      body = [];
    } else if (pathname === '/api/v1/admin/announcements') {
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

  await page.goto(`${baseUrl}/admin/creators`);
  await page.getByRole('button', { name: '注册主播' }).click();
  await expect(page.getByLabel('搜索用户')).toBeFocused();
  await expect(page.getByLabel('搜索用户')).toBeInViewport();

  await page.goto(`${baseUrl}/admin/verification`);
  await page.getByRole('button', { name: '添加直播间' }).click();
  await expect(page.getByLabel('显示名称')).toBeFocused();
  await expect(page.getByLabel('显示名称')).toBeInViewport();

  await page.goto(`${baseUrl}/admin/announcements`);
  await page.getByRole('button', { name: '新建公告' }).click();
  await expect(page.getByLabel('标题')).toBeFocused();
  await expect(page.getByLabel('标题')).toBeInViewport();
});
