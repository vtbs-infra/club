import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';

import { buildApp } from '../../src/server/app.js';
import { auditLogs, giftOrders } from '../../src/server/infrastructure/db/schema/index.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth } from '../../src/server/modules/auth/auth.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import type { IdentityChallenge } from '../../src/shared/contracts/auth.js';
import type { CreatorRecord, Identity } from '../../src/shared/contracts/creators.js';
import type { GiftOrderSummaryPage, GiftRelease } from '../../src/shared/contracts/gifts.js';
import type { AdminSnapshotPage } from '../../src/shared/contracts/snapshots.js';
import { FakeCreatorProfileSource } from '../helpers/fake-creator-profile-source.js';
import {
  buildFakeRosterScenario,
  FakeGuardRosterSource,
} from '../helpers/fake-guard-roster-source.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import { createIntegrationDatabase } from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';

const NOW = new Date('2026-07-31T15:59:00.000Z');
const PASSWORD = 'e2e-only-password-2026';

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP port.');
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

test('registers, verifies, publishes, claims, exports, ships and corrects using the real application', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await createIntegrationDatabase('browser_e2e');
  const storage = await createTemporaryStorage();
  const port = await availablePort();
  const appUrl = `http://127.0.0.1:${port}`;
  const config = createTestConfig({ appUrl, databaseUrl: fixture.databaseUrl, port });
  const auth = createAuth({ config, database: fixture.database });
  const source = new FakeLiveMessageSource();
  const roster = new FakeGuardRosterSource();
  roster.setScenario(
    buildFakeRosterScenario([
      {
        biliUid: '880002',
        displayName: '礼物用户',
        rawTier: '3',
        sourcePosition: 1,
        tier: 'CAPTAIN',
      },
    ]),
  );
  const app = await buildApp({
    auth,
    clock: { now: () => NOW },
    config,
    database: fixture.database,
    creatorProfileSource: new FakeCreatorProfileSource(),
    guardRosterSource: roster,
    liveMessageSource: source,
    serveStatic: true,
    startBackground: true,
    storage: storage.driver,
    webRoot: resolve('dist/web'),
  });
  const adminContext = await browser.newContext();
  const creatorContext = await browser.newContext();
  const recipientContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const pageErrors: string[] = [];
  try {
    await bootstrapPlatformAdmin({
      database: fixture.database,
      username: 'admin',
      name: '平台管理员',
      password: PASSWORD,
    });
    await app.listen({ host: '127.0.0.1', port });
    const admin = await adminContext.newPage();
    const creator = await creatorContext.newPage();
    const recipient = await recipientContext.newPage();
    for (const page of [admin, creator, recipient]) {
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.clock.setFixedTime(NOW);
    }
    async function login(page: Page, username: string) {
      await page.goto(`${appUrl}/login`);
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page).toHaveURL(/\/(dashboard|admin|creator)$/);
    }
    async function post<T>(page: Page, path: string, data: unknown) {
      return json<T>(await page.request.post(appUrl + path, { data, headers: { origin: appUrl } }));
    }
    async function register(page: Page, username: string, name: string, biliUid: string) {
      await page.goto(`${appUrl}/register`);
      const issued = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/challenges') &&
          response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
      const response = await issued;
      expect(response.status()).toBe(201);
      const challenge = (await response.json()) as IdentityChallenge;
      const roomId = challenge.room.link.split('/').at(-1)!;
      await expect.poll(() => source.activeConnectionCount(roomId)).toBe(1);
      await source.emitMessage({
        biliDisplayName: name,
        biliUid,
        message: challenge.code!,
        occurredAt: NOW,
        roomId,
      });
      await expect(page.getByText('已验证 UID ' + biliUid)).toBeVisible();
      await page.getByLabel('昵称').fill(name);
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('新密码', { exact: true }).fill(PASSWORD);
      await page.getByLabel('确认密码', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
      await expect(page.getByText('账号已创建，请使用用户名和密码登录。')).toBeVisible();
      await login(page, username);
    }

    await login(admin, 'admin');
    await post(admin, '/api/v1/admin/verification-rooms', {
      biliRoomId: '990000',
      displayName: '验证直播间',
      priority: 1,
    });
    await register(creator, 'creator', '主播账号', '880001');
    const identity = await json<Identity>(await creator.request.get(`${appUrl}/api/v1/me`));
    const registeredCreator = await post<CreatorRecord>(admin, '/api/v1/admin/creators', {
      userId: identity.user.id,
      timezone: 'Asia/Shanghai',
      monthlySyncEnabled: true,
    });
    await register(recipient, 'recipient', '礼物用户', '880002');
    expect((await recipient.request.get(`${appUrl}/api/v1/admin/creators`)).status()).toBe(403);

    const release = await post<GiftRelease>(creator, '/api/v1/creator/releases', {
      title: '七月礼物草稿',
      description: '感谢支持',
      eligibilityMonth: '2026-07-01',
      claimStartAt: '2026-07-31T00:00:00.000Z',
      claimDeadlineAt: '2026-08-07T00:00:00.000Z',
      fulfillmentMode: 'HIGHEST_ONLY',
      publicVisible: true,
      packages: [
        {
          name: '舰长礼包',
          description: '七月纪念',
          items: [{ name: '纪念卡', quantity: 2, description: '' }],
        },
      ],
      tierPackageIndexes: { CAPTAIN: 0, ADMIRAL: 0, GOVERNOR: 0 },
      formFields: [
        { key: 'size', label: '尺码', type: 'RADIO', options: ['M', 'L'], required: true },
      ],
    });
    await creator.goto(`${appUrl}/creator/releases/${release.id}`);
    await creator.getByLabel('礼物名称').fill('七月舰长礼物');
    await creator.getByRole('button', { name: '发布并生成礼物单' }).first().click();
    await creator.getByRole('dialog').getByRole('button', { name: '发布并生成礼物单' }).click();
    await expect(creator.getByText('已发布', { exact: true })).toBeVisible();

    // The real 30-second scheduler creates, captures and finalizes the current monthly run.
    let orders: GiftOrderSummaryPage = { items: [], nextCursor: null };
    await expect
      .poll(
        async () => {
          orders = await json<GiftOrderSummaryPage>(
            await recipient.request.get(`${appUrl}/api/v1/me/gifts`),
          );
          return orders.items.length;
        },
        { timeout: 45_000, intervals: [1000] },
      )
      .toBe(1);
    const order = orders.items[0]!;
    expect(order.status).toBe('CLAIMABLE');
    const runs = await json<AdminSnapshotPage>(
      await admin.request.get(`${appUrl}/api/v1/admin/rosters?creatorId=${registeredCreator.id}`),
    );
    const finalized = runs.items.find((item) => item.run.periodStart === '2026-07-01')!;
    expect(finalized.run.status).toBe('FINALIZED');
    await admin.goto(`${appUrl}/admin/rosters?run=${finalized.run.id}`);
    await expect(admin.getByRole('heading', { name: /2026.*7.*名单/ })).toBeVisible();
    await expect(admin.getByText('礼物用户', { exact: true })).toBeVisible();

    const address = {
      city: '上海市',
      countryRegion: '中国大陆',
      detailedAddress: '测试路 1 号',
      district: '浦东新区',
      phone: '13800138000',
      postalCode: '',
      province: '上海市',
      recipientName: '礼物用户',
      userNote: '',
    };
    await post(recipient, '/api/v1/me/addresses', {
      isDefault: true,
      label: '家',
      payload: address,
    });
    await recipient.setViewportSize({ width: 390, height: 844 });
    await recipient.goto(`${appUrl}/gifts/${order.id}`);
    await expect(recipient.getByRole('radio', { name: /家/ })).toBeChecked();
    await recipient.getByRole('radio', { name: 'L', exact: true }).check();
    await recipient.getByRole('checkbox').check();
    await recipient.getByRole('button', { name: '确认领取礼物' }).click();
    await expect(recipient.getByRole('heading', { name: '礼物进度' })).toBeVisible();

    await creator.goto(`${appUrl}/creator/orders`);
    await creator.getByRole('button', { name: '导出待发货清单' }).click();
    const downloadReady = creator.waitForEvent('download');
    await creator.getByRole('dialog').getByRole('button', { name: '导出 1 条' }).click();
    const download = await downloadReady;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await download.path());
    const sheet = workbook.worksheets[0]!;
    expect(sheet.rowCount).toBe(2);
    expect(JSON.stringify(sheet.getRow(2).values)).toContain('测试路 1 号');
    expect(JSON.stringify(sheet.getRow(2).values)).toContain('纪念卡');
    expect(sheet.getRow(2).values).toContain('L');

    await creator.goto(`${appUrl}/creator/orders/${order.id}`);
    await creator.getByLabel('快递公司', { exact: true }).fill('中通快递');
    await creator.getByLabel('运单号', { exact: true }).fill('ZT123456');
    await creator.getByRole('button', { name: '确认发货', exact: true }).click();
    await creator
      .getByRole('dialog')
      .getByRole('button', { name: '确认发货', exact: true })
      .click();
    await expect(creator.getByRole('heading', { name: '发货信息' })).toBeVisible();
    await creator.getByRole('button', { name: '更正发货信息' }).click();
    await creator.getByLabel('运单号', { exact: true }).fill('ZT654321');
    await creator.getByRole('button', { name: '保存更正', exact: true }).click();
    await creator
      .getByRole('dialog')
      .getByRole('button', { name: '保存更正', exact: true })
      .click();
    await expect(creator.getByText('ZT654321', { exact: true })).toBeVisible();
    await recipient.reload();
    await expect(recipient.getByText('ZT654321', { exact: true })).toBeVisible();
    await recipient.getByRole('button', { name: '复制单号' }).click();
    expect(await recipient.evaluate<string>('navigator.clipboard.readText()')).toBe('ZT654321');
    await recipient.screenshot({
      path: testInfo.outputPath('recipient-shipped-mobile.png'),
      fullPage: true,
    });
    const [stored] = await fixture.database.orm
      .select()
      .from(giftOrders)
      .where(eq(giftOrders.id, order.id));
    expect(stored).toMatchObject({
      status: 'SHIPPED',
      trackingNumber: 'ZT654321',
      version: 4,
      shippedByUserId: identity.user.id,
    });
    const [audit] = await fixture.database.orm
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetId, order.id),
          eq(auditLogs.action, 'gift-order.shipping-corrected'),
        ),
      );
    expect(audit).toMatchObject({
      beforeSummary: { trackingNumber: 'ZT123456' },
      afterSummary: { trackingNumber: 'ZT654321' },
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all([adminContext.close(), creatorContext.close(), recipientContext.close()]);
    await app.close();
    await storage.cleanup();
    await fixture.cleanup();
  }
});
