import { APPLICATION_VERSION } from '../../src/server/application-version.js';

import { fulfillJson, mockApi, mockJson, requestPath } from './support/api.js';
import { portalHome, recipientIdentity, testId, testTime } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('serves the public product shell and liveness API', async ({ appUrl, page, request }) => {
  await mockJson(
    page,
    '**/api/v1/portal/home',
    portalHome({
      announcements: [
        {
          id: testId(21),
          pinned: true,
          publishedAt: testTime(-1),
          severity: 'INFO',
          summary: '新的舰长礼物已经开放领取。',
          title: '八月礼物领取通知',
        },
        {
          id: testId(22),
          pinned: false,
          publishedAt: testTime(-2),
          severity: 'INFO',
          summary: '验证 UID 并注册后即可自动检查礼物资格。',
          title: '领取流程说明',
        },
      ],
      releases: [
        {
          claimDeadlineAt: testTime(30),
          claimStartAt: testTime(-1),
          coverImageUrl: null,
          creatorName: '测试主播',
          description: '本月舰长纪念礼物。',
          eligibilityMonth: '2026-08-01',
          id: testId(23),
          title: '八月舰长礼物',
        },
      ],
    }),
  );

  await page.goto(appUrl);
  await expect(page.getByRole('heading', { name: '属于你的舰长礼物，都在这里。' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '八月舰长礼物' })).toBeVisible();
  await expect(page.getByText('八月礼物领取通知').first()).toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole('link', { exact: true, name: '登录' })).toBeVisible();
  await page.getByRole('link', { exact: true, name: '注册' }).click();
  await expect(page.getByRole('heading', { name: '开始使用 Club', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '验证 B站身份', exact: true })).toBeVisible();
  await expect(page.getByLabel('用户名')).toHaveCount(0);

  const live = await request.get(`${appUrl}/health/live`);
  expect(live.ok()).toBe(true);
  await expect(live.json()).resolves.toMatchObject({
    status: 'ok',
    version: APPLICATION_VERSION,
  });
});

test('keeps signed-in visitors on the public home until they choose the workspace', async ({
  appUrl,
  page,
}) => {
  await mockJson(page, '**/api/v1/portal/home', portalHome());
  await mockJson(page, '**/api/v1/me', recipientIdentity({ id: testId(11) }));

  await page.goto(appUrl);

  await expect(page).toHaveURL(`${appUrl}/`);
  await expect(page.getByRole('heading', { name: '属于你的舰长礼物，都在这里。' })).toBeVisible();
  const workspaceLink = page.getByRole('link', { exact: true, name: '进入工作台' }).first();
  await expect(workspaceLink).toBeVisible();
  await expect(workspaceLink).toHaveAttribute('href', '/app');
  await expect(page.getByRole('link', { exact: true, name: '登录' })).toHaveCount(0);
});

test('verifies UID before completing registration and returns to a clean login form', async ({
  appUrl,
  page,
}) => {
  const challenge = {
    id: testId(10),
    purpose: 'REGISTER',
    status: 'PENDING',
    code: 'CLUB-ABCDEFGH23',
    expiresAt: testTime(1),
    room: { displayName: '验证房间', link: 'https://live.bilibili.com/777001' },
    connectionState: 'HEALTHY',
    biliUid: null,
    username: null,
  };
  let verified = false;
  await mockJson(page, '**/api/v1/auth/challenges', challenge, 201);
  await page.route('**/api/v1/auth/challenges/' + challenge.id, (route) =>
    fulfillJson(
      route,
      verified ? { ...challenge, status: 'VERIFIED', biliUid: '10001' } : challenge,
    ),
  );
  await mockJson(page, '**/api/v1/auth/register', { id: testId(11), username: 'new_user' }, 201);
  await page.goto(`${appUrl}/register`);
  await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
  await expect(page.getByText(challenge.code)).toBeVisible();
  await expect(page.getByLabel('用户名')).toHaveCount(0);
  verified = true;
  await expect(page.getByText('已验证 UID 10001')).toBeVisible();
  await page.getByLabel('昵称').fill('新用户');
  await page.getByLabel('用户名', { exact: true }).fill('new_user');
  await page.getByLabel('新密码', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByLabel('确认密码', { exact: true }).fill('mismatched-password');
  await expect(page.getByRole('button', { name: '创建账号', exact: true })).toBeDisabled();
  await page.getByLabel('确认密码', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('账号已创建，请使用用户名和密码登录。')).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
});

test('reveals username after recovery verification and resets the password', async ({
  appUrl,
  page,
}) => {
  const challenge = {
    id: testId(12),
    purpose: 'RECOVER',
    status: 'PENDING',
    code: 'CLUB-ABCDEFGH24',
    expiresAt: testTime(1),
    room: { displayName: '验证房间', link: 'https://live.bilibili.com/777001' },
    connectionState: 'HEALTHY',
    biliUid: null,
    username: null,
  };
  let verified = false;
  await mockJson(page, '**/api/v1/auth/challenges', challenge, 201);
  await page.route('**/api/v1/auth/challenges/' + challenge.id, (route) =>
    fulfillJson(
      route,
      verified
        ? { ...challenge, status: 'VERIFIED', biliUid: '10001', username: 'recoverable_user' }
        : challenge,
    ),
  );
  await mockJson(page, '**/api/v1/auth/recover', null);
  await page.goto(`${appUrl}/login`);
  await page.getByRole('link', { name: '忘记用户名或密码？' }).click();
  await page.getByLabel('B站 UID').fill('10001');
  await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
  await expect(page.getByText(challenge.code)).toBeVisible();
  await expect(page.getByText('recoverable_user')).toHaveCount(0);
  verified = true;
  await expect(page.getByText('recoverable_user')).toBeVisible();
  await page.getByLabel('新密码', { exact: true }).fill('a-new-password-for-login');
  await page.getByLabel('确认密码', { exact: true }).fill('a-new-password-for-login');
  await page.getByRole('button', { name: '设置新密码', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('密码已更新，请重新登录。')).toBeVisible();
});

test('clears the credential form when the user signs out', async ({ appUrl, page }) => {
  await page.route('**/api/v1/auth/login', (route) => fulfillJson(route, {}));
  await page.route('**/api/v1/auth/logout', (route) => fulfillJson(route, {}));
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return recipientIdentity({ id: testId(11) });
    if (pathname === '/api/v1/me/gifts/overview')
      return {
        counts: { claimable: 0, upcoming: 0, submitted: 0, shipped: 0, expired: 0, cancelled: 0 },
        urgent: null,
      };
    if (pathname === '/api/v1/me/gifts' || pathname === '/api/v1/me/announcements') {
      return { items: [], nextCursor: null };
    }
    if (pathname.startsWith('/api/v1/me/')) return [];
    return undefined;
  });

  await page.goto(`${appUrl}/login`);
  await page.getByLabel('用户名').fill('viewer');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: '欢迎回来，测试用户！' })).toBeVisible();

  await page.getByRole('button', { name: '测试用户的账号菜单' }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('用户名')).toHaveValue('');
  await expect(page.getByLabel('密码')).toHaveValue('');
});
