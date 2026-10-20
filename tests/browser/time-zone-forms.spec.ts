import { fulfillJson, mockApi, mockJson, requestJsonObject } from './support/api.js';
import { announcement, creatorIdentity, giftRelease } from './support/fixtures.js';
import { expect, freezeBrowserTime, test, TEST_NOW } from './support/test.js';

for (const kind of ['release', 'announcement'] as const) {
  for (const mode of ['new', 'edit'] as const) {
    test(`submits the ${mode} ${kind} form in the time zone it shows after identity refreshes`, async ({
      appUrl,
      page,
    }) => {
      await freezeBrowserTime(page);
      let identity = creatorIdentity({ creator: { timezone: 'Asia/Tokyo' } });
      const release = giftRelease({
        claimStartAt: '2026-08-01T00:00:00.000Z',
        claimDeadlineAt: '2026-08-02T00:00:00.000Z',
      });
      const notice = announcement({
        scope: 'CREATOR',
        status: 'DRAFT',
        publishedAt: null,
        expiresAt: '2026-08-02T00:00:00.000Z',
      });
      let saved: Record<string, unknown> | null = null;
      const prefix = `/api/v1/creator/${kind === 'release' ? 'releases' : 'announcements'}`;
      const id = kind === 'release' ? release.id : notice.id;
      await mockApi(page, 'GET', '/api/v1/me', (route) => fulfillJson(route, identity));
      await mockJson(page, 'GET', `${prefix}/${id}`, kind === 'release' ? release : notice);
      if (kind === 'announcement') {
        await mockJson(page, 'GET', prefix, {
          items: mode === 'edit' ? [notice] : [],
          nextCursor: null,
        });
      }
      await mockApi(
        page,
        mode === 'new' ? 'POST' : 'PUT',
        mode === 'new' ? prefix : `${prefix}/${id}`,
        (route) => {
          saved = requestJsonObject(route.request());
          return fulfillJson(route, kind === 'release' ? release : notice);
        },
      );

      await page.goto(
        `${appUrl}/creator/${kind === 'release' ? `releases/${mode === 'new' ? 'new' : id}` : 'announcements'}`,
      );
      if (kind === 'announcement' && mode === 'edit') {
        await page.getByRole('button', { name: new RegExp(notice.title) }).click();
        await expect(page.getByLabel('标题', { exact: true })).toHaveValue(notice.title);
      }
      const title = page.getByLabel(kind === 'release' ? '礼物名称' : '标题', { exact: true });
      await title.fill('保留我的修改');
      if (kind === 'release') {
        await page.getByLabel('开始领取').fill('2026-08-01T09:00');
        await page.getByLabel('截止领取').fill('2026-08-02T09:00');
      } else {
        await page.getByRole('textbox', { name: '正文', exact: true }).fill('保留我的正文');
        await page.getByLabel('失效时间（可选）').fill('2026-08-02T09:00');
      }

      // A reconnect refreshes stale identity data while the edited form remains open.
      identity = creatorIdentity({
        creator: { timezone: 'Asia/Shanghai', displayName: '时区配置已更新' },
      });
      await page.clock.setFixedTime(new Date(TEST_NOW.getTime() + 20_000));
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
      });
      await page.evaluate(() => {
        window.dispatchEvent(new Event('online'));
      });
      await expect(page.getByRole('button', { name: '时区配置已更新的账号菜单' })).toBeVisible();
      await expect(page.getByText('时区：Asia/Tokyo', { exact: true }).first()).toBeVisible();

      await page
        .getByRole('button', {
          name: kind === 'announcement' && mode === 'edit' ? '保存修改' : '保存草稿',
          exact: true,
        })
        .first()
        .click();
      await expect
        .poll(() => saved)
        .toMatchObject({
          timeZone: 'Asia/Tokyo',
          ...(kind === 'release'
            ? { claimStartLocal: '2026-08-01T09:00', claimDeadlineLocal: '2026-08-02T09:00' }
            : { expiresLocal: '2026-08-02T09:00' }),
        });
    });
  }
}
