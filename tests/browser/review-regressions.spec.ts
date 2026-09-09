import sharp from 'sharp';

import { fulfillJson, requestJsonObject, requestPath } from './support/api.js';
import {
  addressRecord,
  announcement,
  creatorIdentity,
  giftOrder,
  giftRelease,
  portalHome,
  recipientIdentity,
  testId,
} from './support/fixtures.js';
import { expect, freezeBrowserTime, test, TEST_NOW } from './support/test.js';

function defaultReply(path: string): unknown {
  if (path === '/api/v1/appearance') return { themePreset: 'moe' };
  if (path === '/api/v1/portal/home') return portalHome();
  if (path === '/api/v1/me/bilibili-binding') return null;
  if (path === '/api/v1/me/gifts/overview')
    return {
      urgent: null,
      counts: { claimable: 0, upcoming: 0, submitted: 0, shipped: 0, expired: 0, cancelled: 0 },
    };
  return { items: [], nextCursor: null };
}

test('drops all private cached data when an expired session signs into another account', async ({
  appUrl,
  page,
}) => {
  await page.clock.install({ time: TEST_NOW });
  let account: 'A' | 'B' | 'EXPIRED' = 'A';
  let requestedB = false;
  const releaseAddresses = Promise.withResolvers<void>();
  const privateAddress = addressRecord({
    payload: {
      ...addressRecord().payload,
      recipientName: 'A_PRIVATE_RECIPIENT',
      detailedAddress: 'A_PRIVATE_STREET',
    },
  });
  await page.route('**/api/**', async (route) => {
    const path = requestPath(route.request());
    if (path === '/api/auth/sign-in/email') {
      account = 'B';
      return fulfillJson(route, {});
    }
    if (path === '/api/v1/me') {
      if (account === 'EXPIRED')
        return fulfillJson(
          route,
          { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Expired' } },
          401,
        );
      return fulfillJson(
        route,
        recipientIdentity({ id: testId(account === 'A' ? 101 : 102), name: `Account ${account}` }),
      );
    }
    if (path === '/api/v1/me/addresses') {
      if (account === 'A') return fulfillJson(route, [privateAddress]);
      requestedB = true;
      await releaseAddresses.promise;
      return fulfillJson(route, []);
    }
    return fulfillJson(route, defaultReply(path));
  });
  try {
    await page.goto(`${appUrl}/account/addresses`);
    await expect(page.getByText('A_PRIVATE_RECIPIENT')).toBeVisible();
    account = 'EXPIRED';
    await page.clock.fastForward(20_000);
    await page.locator('a.brand').first().click();
    await page.getByRole('link', { name: '登录', exact: true }).first().click();
    await page.getByLabel('邮箱').fill('b@example.com');
    await page.getByLabel('密码').fill('fixture-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(`${appUrl}/dashboard`);
    await page.getByRole('button', { name: 'Account B的账号菜单' }).click();
    await page.getByRole('menuitem', { name: '收货地址' }).click();
    await expect.poll(() => requestedB).toBe(true);
    await expect(page.getByText('A_PRIVATE_RECIPIENT')).toHaveCount(0);
    await expect(page.getByText('A_PRIVATE_STREET', { exact: false })).toHaveCount(0);
    releaseAddresses.resolve();
    await expect(page.getByText('还没有收货地址。')).toBeVisible();
  } finally {
    releaseAddresses.resolve();
  }
});

test('retains the form version across cover refresh and renders its preview under production CSP', async ({
  appUrl,
  page,
}) => {
  await freezeBrowserTime(page);
  let serverRelease = giftRelease({ description: '原始说明', version: 3 });
  let releaseReads = 0;
  let save: Record<string, unknown> | null = null;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = requestPath(request);
    if (path === '/api/v1/me') return fulfillJson(route, creatorIdentity());
    if (path === `/api/v1/creator/releases/${serverRelease.id}/cover`)
      return fulfillJson(route, { coverImageUrl: null });
    if (path === `/api/v1/creator/releases/${serverRelease.id}`) {
      if (request.method() === 'PUT') {
        save = requestJsonObject(request);
        return fulfillJson(
          route,
          { error: { code: 'GIFT_RELEASE_VERSION_CONFLICT', message: 'Version conflict' } },
          409,
        );
      }
      releaseReads += 1;
      return fulfillJson(route, serverRelease);
    }
    return fulfillJson(route, defaultReply(path));
  });
  await page.goto(`${appUrl}/creator/releases/${serverRelease.id}`);
  await page.getByLabel('礼物名称').fill('我的未保存修改');
  serverRelease = { ...serverRelease, description: '其他编辑者的新说明', version: 4 };
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  const preview = page.getByAltText('待上传封面预览');
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((element) => ('naturalWidth' in element ? element.naturalWidth : null)),
    )
    .toBe(1);
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await expect.poll(() => releaseReads).toBeGreaterThan(1);
  await expect(page.getByRole('textbox', { name: '礼物说明', exact: true })).toHaveValue(
    '原始说明',
  );
  await page.getByRole('button', { name: '保存草稿', exact: true }).first().click();
  await expect
    .poll(() => save)
    .toMatchObject({ expectedVersion: 3, description: '原始说明', title: '我的未保存修改' });
  await expect(page.getByText('礼物草稿已在其他页面被修改，请刷新后再试。')).toBeVisible();
  expect(serverRelease.description).toBe('其他编辑者的新说明');
});

test('refreshes effective gift status at both claim window boundaries', async ({
  appUrl,
  page,
}) => {
  await page.clock.install({ time: TEST_NOW });
  const start = new Date(TEST_NOW.getTime() + 60_000).toISOString();
  const deadline = new Date(TEST_NOW.getTime() + 120_000).toISOString();
  let reads = 0;
  const order = giftOrder({
    status: 'UPCOMING',
    release: { claimStartAt: start, claimDeadlineAt: deadline },
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = requestPath(route.request());
    if (path === '/api/v1/me') return fulfillJson(route, recipientIdentity());
    if (path === '/api/v1/me/addresses') return fulfillJson(route, []);
    if (path === `/api/v1/me/gifts/${order.id}`) {
      reads += 1;
      return fulfillJson(route, {
        ...order,
        status: reads === 1 ? 'UPCOMING' : reads === 2 ? 'CLAIMABLE' : 'EXPIRED',
      });
    }
    return fulfillJson(route, defaultReply(path));
  });
  await page.goto(`${appUrl}/gifts/${order.id}`);
  await expect(page.getByText('领取将在', { exact: false })).toBeVisible();
  await page.clock.fastForward(65_000);
  await expect(page.getByRole('heading', { name: '选择收货地址' })).toBeVisible();
  expect(reads).toBe(2);
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('heading', { name: '选择收货地址' })).toHaveCount(0);
  await expect(page.getByText('已过期', { exact: true }).first()).toBeVisible();
  expect(reads).toBe(3);
});

test('acknowledges only the displayed announcement body version after it loads', async ({
  appUrl,
  page,
}) => {
  await freezeBrowserTime(page);
  const summary = announcement();
  const releaseBody = Promise.withResolvers<void>();
  let detailRequested = false;
  const acknowledgments: Record<string, unknown>[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = requestPath(request);
    if (path === '/api/v1/me') return fulfillJson(route, recipientIdentity());
    if (path === '/api/v1/me/announcements')
      return fulfillJson(route, {
        items: [{ ...summary, read: acknowledgments.length > 0 }],
        nextCursor: null,
      });
    if (path === `/api/v1/me/announcements/${summary.id}/read`) {
      acknowledgments.push(requestJsonObject(request));
      return fulfillJson(route, {});
    }
    if (path === `/api/v1/me/announcements/${summary.id}`) {
      detailRequested = true;
      await releaseBody.promise;
      return fulfillJson(route, {
        ...summary,
        body: '第二版正文',
        version: 2,
        read: acknowledgments.length > 0,
      });
    }
    return fulfillJson(route, defaultReply(path));
  });
  try {
    await page.goto(`${appUrl}/announcements`);
    await page.getByRole('button', { name: new RegExp(summary.title) }).click();
    await expect.poll(() => detailRequested).toBe(true);
    await expect(page.getByText('正在读取公告正文…')).toBeVisible();
    expect(acknowledgments).toEqual([]);
    releaseBody.resolve();
    await expect(page.getByText('第二版正文')).toBeVisible();
    await expect.poll(() => acknowledgments).toEqual([{ version: 2 }]);
  } finally {
    releaseBody.resolve();
  }
});
