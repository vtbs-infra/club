import { fulfillJson, mockApi, requestJsonObject, requestPath } from './support/api.js';
import { adminIdentity, systemStatus } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('previews locally and restores the applied theme on cancel or navigation', async ({
  appUrl,
  page,
}) => {
  let updateCount = 0;
  await page.route('**/api/v1/admin/appearance', async (route) => {
    updateCount += 1;
    await fulfillJson(route, { themePreset: 'pixel' });
  });
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/system') return systemStatus();
    if (pathname === '/api/v1/admin/audit-logs') return { items: [], nextCursor: null };
    return undefined;
  });

  await page.goto(`${appUrl}/admin/appearance`);
  await expect(page.getByRole('heading', { name: '主题与外观' })).toBeVisible();
  await page.locator('input[value="neon"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'neon');
  expect(updateCount).toBe(0);

  await page.getByRole('button', { name: '取消预览' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'moe');
  expect(updateCount).toBe(0);

  await page.locator('input[value="pixel"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'pixel');
  await page.getByRole('link', { name: '系统' }).click();
  await expect(page).toHaveURL(/\/admin\/system$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'moe');
  expect(updateCount).toBe(0);
});

test('applies only explicit saves and keeps a failed candidate in preview', async ({
  appUrl,
  page,
}) => {
  let appliedTheme = 'moe';
  let failNext = false;
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/v1/appearance', (route) =>
    fulfillJson(route, { themePreset: appliedTheme }),
  );
  await page.route('**/api/v1/admin/appearance', async (route) => {
    const input = requestJsonObject(route.request());
    requests.push(input);
    if (failNext) {
      await route.fulfill({
        json: {
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred.',
            requestId: 'appearance-request-id',
          },
        },
        status: 500,
      });
      return;
    }
    appliedTheme = String(input.themePreset);
    await fulfillJson(route, { themePreset: appliedTheme });
  });
  await mockApi(page, (request) => {
    if (requestPath(request) === '/api/v1/me') return adminIdentity();
    return undefined;
  });

  await page.goto(`${appUrl}/admin/appearance`);
  await page.locator('input[value="archive"]').check();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '应用到整个应用' }).click();
  await expect.poll(() => requests).toEqual([{ themePreset: 'archive' }]);
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'archive');

  failNext = true;
  await page.locator('input[value="pixel"]').check();
  await page.getByRole('button', { name: '应用到整个应用' }).click();
  await expect.poll(() => requests).toEqual([{ themePreset: 'archive' }, { themePreset: 'pixel' }]);
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'pixel');
  await expect(page.getByText('服务器处理请求时出现异常，请稍后重试。')).toBeVisible();

  await page.getByRole('button', { name: '取消预览' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'archive');
});
