import { mockApi, requestPath } from './support/api.js';
import { adminIdentity, systemStatus, userRecord, verificationRoom } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('keeps admin editors and status badges usable at 800px', async ({ appUrl, page }) => {
  await page.setViewportSize({ height: 900, width: 800 });
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/creators') return [];
    if (pathname === '/api/v1/admin/users') return [userRecord()];
    if (pathname === '/api/v1/admin/verification-rooms') return [verificationRoom()];
    if (pathname === '/api/v1/admin/announcements') return [];
    if (pathname === '/api/v1/admin/system') return systemStatus();
    if (pathname === '/api/v1/admin/audit-logs') return { items: [], nextBefore: null };
    return undefined;
  });

  await page.goto(`${appUrl}/admin/creators`);
  await page.getByRole('button', { name: '注册主播' }).click();
  await expect(page.getByLabel('搜索用户')).toBeFocused();
  await expect(page.getByLabel('搜索用户')).toBeInViewport();

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
