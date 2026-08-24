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
          summary: '绑定 UID 后即可自动检查礼物资格。',
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
  await expect(page.getByLabel('昵称')).toBeVisible();
  await expect(page.getByLabel('邮箱')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();

  const live = await request.get(`${appUrl}/health/live`);
  expect(live.ok()).toBe(true);
  await expect(live.json()).resolves.toMatchObject({ status: 'ok', version: '0.1.0' });
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

test('confirms registration before asking the user to sign in', async ({ appUrl, page }) => {
  await mockJson(page, '**/api/auth/sign-up/email', { user: { id: testId(10) } });

  await page.goto(`${appUrl}/register`);
  await page.getByLabel('昵称').fill('新用户');
  await page.getByLabel('邮箱').fill('new-user@example.com');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '创建账号' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('账号已创建，请使用刚才填写的邮箱和密码登录。')).toBeVisible();
  await expect(page.getByLabel('密码')).toHaveValue('');
});

test('clears the credential form when the user signs out', async ({ appUrl, page }) => {
  await page.route('**/api/auth/sign-in/email', (route) => fulfillJson(route, {}));
  await page.route('**/api/auth/sign-out', (route) => fulfillJson(route, {}));
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return recipientIdentity({ id: testId(11) });
    if (pathname === '/api/v1/me/bilibili-binding') return null;
    if (pathname.startsWith('/api/v1/me/')) return [];
    return undefined;
  });

  await page.goto(`${appUrl}/login`);
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
