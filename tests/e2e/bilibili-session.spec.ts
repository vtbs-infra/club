import { availablePort } from '../helpers/tcp-port.js';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { buildApp } from '../../src/server/app.js';
import { verificationRooms } from '../../src/server/infrastructure/db/schema/index.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import { createIntegrationDatabase } from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';
import { FakeBilibiliPassport } from '../helpers/fake-bilibili-passport.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import { FakeGuardRosterSource } from '../helpers/fake-guard-roster-source.js';
import { FakeCreatorProfileSource } from '../helpers/fake-creator-profile-source.js';

test('manages the Bilibili reader through real HTTP, sessions, database and runtime', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await createIntegrationDatabase('bilibili_browser');
  const storage = await createTemporaryStorage();
  let clockOffset = 0;
  const clock = { now: () => new Date(Date.now() + clockOffset) };
  const passport = new FakeBilibiliPassport(clock);
  passport.waiting = true;
  const live = new FakeLiveMessageSource();
  const password = 'browser-admin-password';
  const port = await availablePort();
  const appUrl = `http://127.0.0.1:${port}`;
  const app = await buildApp({
    config: createTestConfig({ databaseUrl: fixture.databaseUrl, appUrl, port }),
    database: fixture.database,
    clock,
    bilibiliPassport: passport,
    liveMessageSource: live,
    creatorProfileSource: new FakeCreatorProfileSource(),
    guardRosterSource: new FakeGuardRosterSource(),
    storage: storage.driver,
    startBackground: true,
    serveStatic: true,
    webRoot: resolve('dist/web'),
  });
  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    await fixture.database.orm
      .insert(verificationRooms)
      .values({ biliRoomId: '777001', displayName: '验证房间' });
    await bootstrapPlatformAdmin({
      database: fixture.database,
      username: 'admin',
      name: 'Admin',
      password,
    });
    await app.listen({ host: '127.0.0.1', port });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${appUrl}/login`);
    await page.getByLabel('用户名', { exact: true }).fill('admin');
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`${appUrl}/admin/verification`);
    await expect(page.getByRole('heading', { name: 'B站集成', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '扫码登录 B站', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'B站读取账号登录' });
    await expect(dialog.locator('svg')).toBeVisible();
    await expect(dialog.getByText('等待扫码或手机确认')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '继续扫码登录' }).click();
    dialog = page.getByRole('dialog', { name: 'B站读取账号登录' });
    await expect(dialog.locator('svg')).toBeVisible();
    let failPoll = true;
    await page.route('**/api/v1/admin/bilibili/login-attempts/*', async (route) => {
      if (route.request().method() === 'GET' && failPoll) {
        failPoll = false;
        await route.abort();
      } else await route.continue();
    });
    passport.waiting = false;
    await expect(dialog.getByRole('button', { name: '启用此账号' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByText(`UID ${passport.uid}`)).toBeVisible();
    await dialog.getByRole('button', { name: '启用此账号' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('登录有效', { exact: true })).toBeVisible();
    await expect.poll(() => live.activeConnectionCount('777001')).toBe(1);
    await expect(page.getByText('尚无真实 UID 弹幕样本')).toBeVisible();
    await live.emitMessage({
      biliUid: '99887766',
      biliDisplayName: 'Member',
      roomId: '777001',
      message: '731426',
      eventId: 'browser-sample',
    });
    await expect(page.getByText(/最近收到真实 UID/)).toBeVisible({ timeout: 10_000 });
    passport.waiting = true;
    await page.getByRole('button', { name: '重新扫码 / 更换账号' }).click();
    dialog = page.getByRole('dialog', { name: 'B站读取账号登录' });
    await expect(dialog.locator('svg')).toBeVisible();
    clockOffset += 181_000;
    await expect(dialog.getByText('二维码或候选账号已过期')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('登录有效', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭并取消' }).click();
    await page.getByRole('button', { name: '断开连接', exact: true }).click();
    await page
      .getByRole('dialog', { name: '断开 B站读取账号？' })
      .getByRole('button', { name: '断开连接', exact: true })
      .click();
    await expect(page.getByRole('button', { name: '扫码登录 B站', exact: true })).toBeVisible();
    await expect.poll(() => live.activeConnectionCount('777001')).toBe(0);
    expect((await context.request.get(`${appUrl}/health/ready`)).status()).toBe(200);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await app.close();
    await storage.cleanup();
    await fixture.cleanup();
  }
});
