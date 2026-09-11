import { APPLICATION_VERSION } from '../../src/server/application-version.js';

import { fulfillJson, mockApi, mockJson, requestPath } from './support/api.js';
import { portalHome, recipientIdentity, testId, testTime } from './support/fixtures.js';
import { expect, freezeBrowserTime, test, TEST_NOW } from './support/test.js';

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
    expiresAt: new Date(TEST_NOW.getTime() + 10 * 60_000).toISOString(),
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
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue(
    challenge.code,
  );
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
    expiresAt: new Date(TEST_NOW.getTime() + 10 * 60_000).toISOString(),
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
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue(
    challenge.code,
  );
  await expect(page.getByText('recoverable_user')).toHaveCount(0);
  verified = true;
  await expect(page.getByText('recoverable_user')).toBeVisible();
  await page.getByLabel('新密码', { exact: true }).fill('a-new-password-for-login');
  await page.getByLabel('确认密码', { exact: true }).fill('a-new-password-for-login');
  await page.getByRole('button', { name: '设置新密码', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('密码已更新，请重新登录。')).toBeVisible();
});

test('recovers initial polling failures, waits for room readiness and stops polling after proof', async ({
  appUrl,
  page,
}) => {
  await page.clock.install({ time: TEST_NOW });
  const challenge = {
    id: testId(13),
    purpose: 'REGISTER',
    status: 'PENDING',
    code: 'CLUB-ABCDEFGH25',
    expiresAt: new Date(TEST_NOW.getTime() + 10 * 60_000).toISOString(),
    room: { displayName: '验证房间', link: 'https://live.bilibili.com/777001' },
    connectionState: 'CONNECTING',
    biliUid: null,
    username: null,
  };
  let queries = 0;
  let verified = false;
  await mockJson(page, '**/api/v1/auth/challenges', challenge, 201);
  await page.route('**/api/v1/auth/challenges/' + challenge.id, async (route) => {
    queries++;
    if (queries <= 2) {
      await fulfillJson(route, { error: { code: 'TEMPORARY', message: 'Temporary failure' } }, 503);
      return;
    }
    await fulfillJson(route, {
      ...challenge,
      code: undefined,
      connectionState: 'HEALTHY',
      ...(verified ? { status: 'VERIFIED', biliUid: '10001' } : {}),
    });
  });
  await page.goto(`${appUrl}/register`);
  await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
  await expect(page.getByText('连接就绪后会显示验证码，请稍候。')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '打开验证直播间' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试读取验证结果' })).toBeVisible();
  // Polling must resume without a click or a visibility change, even after retries run out.
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue(
    challenge.code,
    { timeout: 8000 },
  );
  await expect(page.getByRole('link', { name: '打开验证直播间' })).toBeVisible();
  verified = true;
  await expect(page.getByText('已验证 UID 10001')).toBeVisible();
  const completedQueries = queries;
  await page.clock.runFor(6000);
  expect(queries).toBe(completedQueries);
});

test('copies the current code and makes the room action usable on desktop and mobile', async ({
  appUrl,
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const challenge = {
    id: testId(30),
    purpose: 'REGISTER',
    status: 'PENDING',
    code: 'CLUB-ABCDEFGH23',
    expiresAt: new Date(TEST_NOW.getTime() + 10 * 60_000).toISOString(),
    room: { displayName: '验证1', link: 'https://live.bilibili.com/24300932' },
    connectionState: 'HEALTHY',
    biliUid: null,
    username: null,
  };
  let requests = 0;
  let current = challenge;
  await page.route('**/api/v1/auth/challenges', async (route) => {
    requests++;
    current =
      requests === 1 ? challenge : { ...challenge, id: testId(31), code: 'CLUB-JKLMNPQR45' };
    await fulfillJson(route, current, 201);
  });
  await page.route('**/api/v1/auth/challenges/*', (route) =>
    fulfillJson(route, { ...current, code: undefined }),
  );
  await context.route(challenge.room.link, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Verification room</title>' }),
  );
  await page.goto(`${appUrl}/register`);
  await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
  const code = page.getByRole('textbox', { name: '验证码', exact: true });
  const copy = page.getByRole('button', { name: '复制验证码' });
  const room = page.getByRole('link', { name: '打开验证直播间' });
  await expect(code).toHaveValue(challenge.code);
  await expect(code).toHaveJSProperty('readOnly', true);
  await expect(room).toHaveAttribute('href', challenge.room.link);
  await expect(room).toHaveAttribute('target', '_blank');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(copy).toBeVisible();
    await expect(room).toBeVisible();
    expect(
      await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'),
    ).toBe(true);
    expect(await code.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`register-${width}.png`), fullPage: true });
  }
  await copy.click();
  await expect(copy).toHaveText('已复制');
  expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe(challenge.code);
  await page.getByRole('button', { name: '重新获取验证码' }).click();
  await expect(code).toHaveValue('CLUB-JKLMNPQR45');
  await expect(copy).toHaveText('复制');
  await copy.click();
  expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe('CLUB-JKLMNPQR45');
  await room.focus();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await expect(popup).toHaveURL(challenge.room.link);
  expect(await popup.evaluate<boolean>('window.opener === null')).toBe(true);
  await popup.close();
  await expect(page).toHaveURL(`${appUrl}/register`);
  await expect(code).toHaveValue('CLUB-JKLMNPQR45');
  await page.route('**/api/v1/appearance', (route) => fulfillJson(route, { themePreset: 'neon' }));
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'neon');
  await expect(room).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('register-neon.png'), fullPage: true });
});

test('supports manual copying, expires old actions and keeps the recovery target explicit', async ({
  appUrl,
  page,
}, testInfo) => {
  await page.clock.install({ time: TEST_NOW });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
    });
  });
  const targets: string[] = [];
  let current = {
    id: testId(32),
    purpose: 'RECOVER',
    status: 'PENDING',
    code: 'CLUB-ABCDEFGH23',
    expiresAt: new Date(TEST_NOW.getTime() + 30_000).toISOString(),
    room: { displayName: '验证1', link: 'https://live.bilibili.com/24300932' },
    connectionState: 'HEALTHY',
    biliUid: null,
    username: null,
  };
  await page.route('**/api/v1/auth/challenges', async (route) => {
    targets.push((route.request().postDataJSON() as { biliUid: string }).biliUid);
    current = {
      ...current,
      id: testId(32 + targets.length),
      expiresAt: new Date(TEST_NOW.getTime() + targets.length * 60_000).toISOString(),
    };
    await fulfillJson(route, current, 201);
  });
  await page.route('**/api/v1/auth/challenges/*', (route) => fulfillJson(route, current));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/recover`);
  await page.getByLabel('B站 UID', { exact: true }).fill('3493095194757549');
  await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
  await expect(page.getByText('请使用 UID 3493095194757549 的 B站账号。')).toBeVisible();
  await page.getByRole('button', { name: '复制验证码' }).click();
  await expect(page.getByText('未能自动复制，已选中验证码，请手动复制。')).toBeVisible();
  const code = page.getByRole('textbox', { name: '验证码', exact: true });
  await expect(code).toBeFocused();
  await expect(code).toHaveJSProperty('selectionStart', 0);
  await expect(code).toHaveJSProperty('selectionEnd', current.code.length);
  await page.screenshot({ path: testInfo.outputPath('recover-copy-fallback.png'), fullPage: true });
  await page.clock.fastForward(61_000);
  await expect(page.getByText('本次验证已失效，请重新验证。')).toBeVisible();
  await expect(code).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复制验证码' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '打开验证直播间' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('recover-expired.png'), fullPage: true });
  await page.getByRole('button', { name: '更换 B站 UID' }).click();
  await page.getByLabel('B站 UID', { exact: true }).fill('20002');
  await page.getByRole('button', { name: '验证 B站身份', exact: true }).click();
  await expect(page.getByText('请使用 UID 20002 的 B站账号。')).toBeVisible();
  expect(targets).toEqual(['3493095194757549', '20002']);
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
