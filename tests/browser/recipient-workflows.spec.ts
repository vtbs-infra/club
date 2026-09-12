import { fulfillJson, mockApi, requestJsonObject, requestPath } from './support/api.js';
import {
  addressRecord,
  announcement,
  giftOrder,
  recipientIdentity,
  testId,
} from './support/fixtures.js';
import { expect, freezeBrowserTime, test, TEST_NOW } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('edits a display name and changes password while keeping account identity immutable', async ({
  appUrl,
  page,
}) => {
  let identity = recipientIdentity();
  let submittedPassword: Record<string, unknown> | null = null;
  await mockApi(page, (request) => {
    const path = requestPath(request);
    if (path === '/api/v1/me') return identity;
    if (path === '/api/v1/me/profile') {
      const input = requestJsonObject(request);
      identity = recipientIdentity({ name: String(input.name) });
      return identity.user;
    }
    if (path === '/api/v1/auth/password') {
      submittedPassword = requestJsonObject(request);
      return null;
    }
    return undefined;
  });
  await page.goto(`${appUrl}/account`);
  await expect(page.getByLabel('用户名', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByText('已验证 B站 UID：' + identity.user.bilibiliUid)).toBeVisible();
  await page.getByLabel('昵称', { exact: true }).fill('新的昵称');
  await page.getByRole('button', { name: '保存昵称' }).click();
  await expect(page.getByRole('button', { name: '新的昵称的账号菜单' })).toBeVisible();
  await page.getByLabel('当前密码', { exact: true }).fill('old-password-for-test');
  await page.getByLabel('新密码', { exact: true }).fill('new-password-for-test');
  await page.getByLabel('确认密码', { exact: true }).fill('different-password');
  await expect(page.getByRole('button', { name: '更新密码' })).toBeDisabled();
  await page.getByLabel('确认密码', { exact: true }).fill('new-password-for-test');
  await page.getByRole('button', { name: '更新密码' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(submittedPassword).toEqual({
    currentPassword: 'old-password-for-test',
    password: 'new-password-for-test',
  });
  await expect(page.getByText('密码已更新，请重新登录。')).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
});

test('supports keyboard navigation and restores focus in the account menu', async ({
  appUrl,
  page,
}) => {
  await mockApi(page, (request) => {
    if (requestPath(request) === '/api/v1/me') return recipientIdentity();
    return undefined;
  });
  await page.goto(`${appUrl}/account`);
  const trigger = page.getByRole('button', { name: '测试用户的账号菜单' });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '账号', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '收货地址' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('preselects the default address even when it is not first in the list', async ({
  appUrl,
  page,
}) => {
  const order = giftOrder();
  await mockApi(page, (request) => {
    const path = requestPath(request);
    if (path === '/api/v1/me') return recipientIdentity();
    if (path === '/api/v1/me/addresses')
      return [
        addressRecord({ isDefault: false, label: '办公室' }),
        addressRecord({ id: testId(26), isDefault: true, label: '家' }),
      ];
    if (path === `/api/v1/me/gifts/${order.id}`) return order;
    return undefined;
  });
  await page.goto(`${appUrl}/gifts/${order.id}`);
  await expect(page.getByRole('radio', { name: /家/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^办公室/ })).not.toBeChecked();
});

test('refreshes effective gift status at both claim window boundaries', async ({
  appUrl,
  page,
}) => {
  await page.clock.install({ time: TEST_NOW });
  const start = new Date(TEST_NOW.getTime() + 60_000).toISOString();
  const deadline = new Date(TEST_NOW.getTime() + 120_000).toISOString();
  let status: 'UPCOMING' | 'CLAIMABLE' | 'EXPIRED' = 'UPCOMING';
  const order = giftOrder({
    status: 'UPCOMING',
    release: { claimStartAt: start, claimDeadlineAt: deadline },
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = requestPath(route.request());
    if (path === '/api/v1/me') return fulfillJson(route, recipientIdentity());
    if (path === '/api/v1/me/addresses') return fulfillJson(route, []);
    if (path === `/api/v1/me/gifts/${order.id}`) {
      return fulfillJson(route, {
        ...order,
        status,
      });
    }
    return route.fallback();
  });
  await page.goto(`${appUrl}/gifts/${order.id}`);
  await expect(page.getByText('领取将在', { exact: false })).toBeVisible();
  status = 'CLAIMABLE';
  await page.clock.fastForward(65_000);
  await expect(page.getByRole('heading', { name: '选择收货地址' })).toBeVisible();
  status = 'EXPIRED';
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('heading', { name: '选择收货地址' })).toHaveCount(0);
  await expect(page.getByText('已过期', { exact: true }).first()).toBeVisible();
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
    return route.fallback();
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
