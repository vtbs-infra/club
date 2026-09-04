import type { GiftRelease } from '../../src/shared/contracts/gifts.js';
import { fulfillJson, requestJsonObject, requestPath } from './support/api.js';
import { creatorIdentity, giftOrder, giftRelease, testId, testTime } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('publishes the creator current edits without a separate save', async ({ appUrl, page }) => {
  const releaseId = testId(30);
  let publishedInput: Record<string, unknown> | null = null;
  let publishedRelease: GiftRelease | null = null;
  const draft = giftRelease({
    description: '尚未保存的说明',
    id: releaseId,
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') {
      await fulfillJson(route, creatorIdentity());
      return;
    }
    if (pathname === `/api/v1/creator/releases/${releaseId}/publish`) {
      publishedInput = requestJsonObject(request);
      if (typeof publishedInput.title !== 'string') {
        throw new Error('The release publish request did not include a title.');
      }
      publishedRelease = {
        ...draft,
        publishedAt: testTime(),
        status: 'PUBLISHED',
        title: publishedInput.title,
        updatedAt: testTime(),
        version: 4,
      };
      await fulfillJson(route, publishedRelease);
      return;
    }
    if (pathname === `/api/v1/creator/releases/${releaseId}`) {
      await fulfillJson(route, publishedRelease ?? draft);
      return;
    }
    if (pathname === '/api/v1/creator/releases') {
      await fulfillJson(route, { items: [], nextCursor: null });
      return;
    }
    await route.fallback();
  });

  await page.goto(`${appUrl}/creator/releases/${releaseId}`);
  await page.getByLabel('礼物名称').fill('当前页面的新标题');
  const publishButton = page.getByRole('button', { name: '发布并生成礼物单' }).first();
  await publishButton.click();

  let dialog = page.getByRole('dialog', { name: '确认发布当前内容？' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '返回' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(publishButton).toBeFocused();

  await publishButton.click();
  dialog = page.getByRole('dialog', { name: '确认发布当前内容？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '发布并生成礼物单' }).click();
  await expect.poll(() => publishedInput).not.toBeNull();
  expect(publishedInput).toMatchObject({
    expectedVersion: 3,
    title: '当前页面的新标题',
  });
  await expect(page.getByText('已发布')).toBeVisible();
});

test('exports submitted orders by release without changing the active list filter', async ({
  appUrl,
  page,
}) => {
  const releaseId = testId(34);
  let exportInput: Record<string, unknown> | null = null;
  const release = giftRelease({
    id: releaseId,
    publishedAt: testTime(-20),
    status: 'PUBLISHED',
    title: '七月舰长礼物',
    version: 1,
  });
  const order = (id: string, status: 'SHIPPED' | 'SUBMITTED') =>
    giftOrder({
      biliDisplayName: status === 'SUBMITTED' ? '待发货用户' : '已发货用户',
      biliUid: status === 'SUBMITTED' ? '11001' : '11002',
      creator: { id: testId(32) },
      id,
      items: [],
      orderNumber:
        status === 'SUBMITTED'
          ? 'G202607-00000000000000000000000000000003'
          : 'G202607-00000000000000000000000000000004',
      release: {
        claimDeadlineAt: release.claimDeadlineAt,
        claimStartAt: release.claimStartAt,
        description: release.description,
        eligibilityMonth: release.eligibilityMonth,
        id: release.id,
        title: release.title,
      },
      shippedAt: status === 'SHIPPED' ? testTime(-1) : null,
      status,
      submittedAt: testTime(-1),
      updatedAt: testTime(-1),
      version: status === 'SUBMITTED' ? 2 : 3,
    });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') {
      await fulfillJson(route, creatorIdentity());
      return;
    }
    if (pathname === '/api/v1/creator/orders/fulfillment-export') {
      exportInput = requestJsonObject(request);
      await route.fulfill({
        body: 'workbook',
        headers: {
          'content-disposition': 'attachment; filename="fulfillment.xlsx"',
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-export-row-count': '1',
        },
        status: 200,
      });
      return;
    }
    if (pathname === '/api/v1/creator/orders') {
      const requestedStatus = new URL(request.url()).searchParams.get('status');
      const orders = [order(testId(35), 'SUBMITTED'), order(testId(36), 'SHIPPED')];
      await fulfillJson(route, {
        items: requestedStatus ? orders.filter((item) => item.status === requestedStatus) : orders,
        nextCursor: null,
      });
      return;
    }
    if (pathname === '/api/v1/creator/orders/fulfillment-releases') {
      await fulfillJson(route, {
        items: [
          {
            claimDeadlineAt: release.claimDeadlineAt,
            eligibilityMonth: release.eligibilityMonth,
            id: release.id,
            submittedCount: 1,
            title: release.title,
          },
        ],
        nextCursor: null,
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`${appUrl}/creator/orders?status=SHIPPED`);
  await expect(page.getByText('已发货用户')).toBeVisible();
  await expect(page.getByText('待发货用户')).toHaveCount(0);
  const exportButton = page.getByRole('button', { name: '导出待发货清单' });
  await expect(exportButton).toBeEnabled();
  await exportButton.click();

  const dialog = page.getByRole('dialog', { name: '导出待发货清单' });
  await expect(dialog.getByText('领取仍在进行')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出 1 条' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fulfillment.xlsx');
  expect(exportInput).toEqual({ releaseId });
  await expect(page.getByText('已导出 1 条待发货收货信息。')).toBeVisible();
});
