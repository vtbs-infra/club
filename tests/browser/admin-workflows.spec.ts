import type { CreatorRecord } from '../../src/shared/contracts/creators.js';

import { mockApi, requestJsonObject, requestPath } from './support/api.js';
import {
  adminIdentity,
  bilibiliBinding,
  bindingConflict,
  systemStatus,
  testId,
  testTime,
  userRecord,
  verificationRoom,
} from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('keeps admin editors and status badges usable at 800px', async ({ appUrl, page }) => {
  await page.setViewportSize({ height: 900, width: 800 });
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/creators') return { items: [], nextCursor: null };
    if (pathname === '/api/v1/admin/users') {
      return [userRecord({ bilibiliBinding: bilibiliBinding() })];
    }
    if (pathname === '/api/v1/admin/verification-rooms') return [verificationRoom()];
    if (pathname === '/api/v1/admin/bilibili-binding-conflicts') {
      return { items: [], nextCursor: null };
    }
    if (pathname === '/api/v1/admin/announcements') return { items: [], nextCursor: null };
    if (pathname === '/api/v1/admin/system') return systemStatus();
    if (pathname === '/api/v1/admin/audit-logs') return { items: [], nextCursor: null };
    return undefined;
  });

  await page.goto(`${appUrl}/admin/creators`);
  await page.getByRole('button', { name: '注册主播' }).click();
  await expect(page.getByLabel('搜索已验证用户')).toBeFocused();
  await expect(page.getByLabel('搜索已验证用户')).toBeInViewport();

  await page.goto(`${appUrl}/admin/verification`);
  const verificationHealth = page.locator('.room-row .status-badge').filter({ hasText: '健康' });
  await expect(verificationHealth).toBeVisible();
  expect((await verificationHealth.boundingBox())?.width).toBeLessThan(90);
  await page.getByRole('button', { name: '添加直播间' }).click();
  await expect(page.getByLabel('显示名称')).toBeFocused();
  await expect(page.getByLabel('显示名称')).toBeInViewport();

  await page.goto(`${appUrl}/admin/announcements`);
  await page.getByRole('button', { name: '新建公告' }).click();
  await expect(page.getByLabel('标题')).toBeFocused();
  await expect(page.getByLabel('标题')).toBeInViewport();

  await page.goto(`${appUrl}/admin/system`);
  const systemHealth = page
    .locator('.simple-list.roster .status-badge')
    .filter({ hasText: '健康' });
  await expect(systemHealth).toBeVisible();
  expect((await systemHealth.boundingBox())?.width).toBeLessThan(90);
});

test('resolves the exact binding recorded by a UID conflict', async ({ appUrl, page }) => {
  const conflict = bindingConflict();
  let openConflicts = [conflict];
  let resolutionPayload: Record<string, unknown> | null = null;
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/verification-rooms') return [verificationRoom()];
    if (pathname === '/api/v1/admin/bilibili-binding-conflicts') {
      return { items: openConflicts, nextCursor: null };
    }
    if (
      pathname === `/api/v1/admin/bilibili-binding-conflicts/${conflict.id}/resolve` &&
      request.method() === 'POST'
    ) {
      resolutionPayload = requestJsonObject(request);
      openConflicts = [];
      return null;
    }
    return undefined;
  });

  await page.goto(`${appUrl}/admin/verification`);
  await expect(page.getByText('申请用户', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '解除原绑定' }).click();
  const dialog = page.getByRole('dialog', { name: '解决这项 UID 冲突？' });
  await dialog.getByLabel('处理原因').fill('已核对 UID 归属证明');
  await dialog.getByRole('button', { name: '确认解决' }).click();

  await expect.poll(() => resolutionPayload).toEqual({ reason: '已核对 UID 归属证明' });
  await expect(page.getByText('当前没有待处理的绑定冲突。')).toBeVisible();
});

test('registers a creator from verified identity without editable Bilibili fields', async ({
  appUrl,
  page,
}) => {
  const binding = bilibiliBinding({ biliDisplayName: 'B站主播', biliUid: '90001' });
  const candidate = userRecord({ bilibiliBinding: binding });
  const creator = {
    bilibiliUid: binding.biliUid,
    createdAt: testTime(-2),
    displayName: 'B站主播',
    email: candidate.email,
    id: testId(43),
    monthlySyncEnabled: true,
    profileSyncedAt: testTime(),
    roomId: '654321',
    timezone: 'Asia/Tokyo',
    userId: candidate.id,
    userName: candidate.name,
  } satisfies CreatorRecord;
  const refreshedCreator = {
    ...creator,
    displayName: 'B站主播新昵称',
    profileSyncedAt: testTime(1),
    roomId: '654322',
  };
  let creators: readonly CreatorRecord[] = [];
  let createPayload: Record<string, unknown> | null = null;
  let profileRefreshes = 0;

  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/users') return [candidate];
    if (pathname === '/api/v1/admin/creators' && request.method() === 'POST') {
      createPayload = requestJsonObject(request);
      creators = [creator];
      return creator;
    }
    if (pathname === '/api/v1/admin/creators') return { items: creators, nextCursor: null };
    if (pathname === `/api/v1/admin/creators/${creator.id}/refresh-profile`) {
      profileRefreshes += 1;
      creators = [refreshedCreator];
      return refreshedCreator;
    }
    return undefined;
  });

  await page.goto(`${appUrl}/admin/creators`);
  await page.getByRole('button', { name: '注册主播' }).click();
  await page.getByLabel('搜索已验证用户').fill(candidate.name);
  await page.getByLabel('普通用户账号').selectOption(candidate.id);
  await expect(page.getByText('B站主播', { exact: true })).toBeVisible();
  await expect(page.locator('form').getByLabel('显示名称')).toHaveCount(0);
  await expect(page.locator('form').getByLabel('B站 UID')).toHaveCount(0);
  await expect(page.locator('form').getByLabel('直播间 ID')).toHaveCount(0);
  await page.getByLabel('名单结算时区').fill('Asia/Tokyo');
  await page.getByRole('button', { name: '注册为主播' }).click();

  await expect
    .poll(() => createPayload)
    .toEqual({
      monthlySyncEnabled: true,
      timezone: 'Asia/Tokyo',
      userId: candidate.id,
    });
  await page.locator('.creator-admin-row').click();
  await page.getByRole('button', { name: '刷新 B站资料' }).click();
  await expect.poll(() => profileRefreshes).toBe(1);
  await expect(page.getByRole('heading', { name: 'B站主播新昵称' })).toBeVisible();
  await expect(page.getByText(/直播间 654322/)).toBeVisible();
});
