import { fulfillJson, mockApi, requestJsonObject, requestPath } from './support/api.js';
import { adminIdentity, portalHome, systemStatus, verificationRoom } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('loads a server-selected theme across public, shell, dropdown, and dialog surfaces', async ({
  appUrl,
  page,
}) => {
  await page.route('**/api/v1/appearance', (route) => fulfillJson(route, { themePreset: 'neon' }));
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/portal/home') return portalHome();
    if (pathname === '/api/v1/admin/verification-rooms') return [verificationRoom()];
    if (pathname === '/api/v1/admin/bilibili-binding-conflicts') {
      return { items: [], nextCursor: null };
    }
    if (pathname === '/api/v1/admin/bilibili-bindings') {
      return { items: [], nextCursor: null };
    }
    if (pathname === '/api/v1/admin/system') return systemStatus();
    if (pathname === '/api/v1/admin/audit-logs') return { items: [], nextCursor: null };
    return undefined;
  });

  await page.goto(appUrl);
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'neon');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#080b16');
  await expect(page.getByRole('heading', { name: '属于你的舰长礼物，都在这里。' })).toBeVisible();

  await page.goto(`${appUrl}/admin/verification`);
  await page.getByRole('button', { name: '平台管理员的账号菜单' }).click();
  const dropdown = page.locator('.account-popover');
  await expect(dropdown).toBeVisible();
  await expect(dropdown).toHaveCSS('background-color', 'rgb(17, 23, 42)');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '添加直播间' }).click();
  await page.getByLabel('显示名称').fill('尚未保存的房间');
  await page.getByRole('link', { name: '系统' }).click();
  const dialog = page.getByRole('dialog', { name: '放弃当前直播间修改？' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('background-color', 'rgb(17, 23, 42)');
  await dialog.getByRole('button', { name: '放弃修改' }).click();
  await expect(page).toHaveURL(/\/admin\/system$/);
});

test('previews locally, cancels, and restores the applied theme when leaving at 390px', async ({
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

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(`${appUrl}/admin/appearance`);
  await expect(page.getByRole('heading', { name: '主题与外观' })).toBeVisible();
  expect(
    await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'),
  ).toBe(true);

  await page.locator('input[value="neon"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'neon');
  await expect(page.getByText(/正在本地预览“直播间控制台”/)).toBeVisible();
  expect(updateCount).toBe(0);

  await page.getByRole('button', { name: '取消预览' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'moe');
  expect(updateCount).toBe(0);

  await page.locator('input[value="pixel"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'pixel');
  await page.getByRole('button', { name: '打开导航' }).click();
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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#efe7d7');
  await expect(page.getByText('“舰长礼物档案馆”已应用到整个应用。')).toBeVisible();

  failNext = true;
  await page.locator('input[value="pixel"]').check();
  await page.getByRole('button', { name: '应用到整个应用' }).click();
  await expect.poll(() => requests).toEqual([{ themePreset: 'archive' }, { themePreset: 'pixel' }]);
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'pixel');
  await expect(page.getByText('服务器处理请求时出现异常，请稍后重试。')).toBeVisible();
  await expect(page.getByText(/正在本地预览“像素补给舰”/)).toBeVisible();

  await page.getByRole('button', { name: '取消预览' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'archive');
});
