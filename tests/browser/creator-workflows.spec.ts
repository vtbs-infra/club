import sharp from 'sharp';
import { fulfillJson, mockApi, mockJson, requestJsonObject } from './support/api.js';
import { creatorIdentity, giftOrder, giftRelease, testId, testTime } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('cancelling publication preserves edits and restores focus', async ({ appUrl, page }) => {
  const draft = giftRelease();
  let published = false;
  await mockJson(page, 'GET', '/api/v1/me', creatorIdentity());
  await mockJson(page, 'GET', `/api/v1/creator/releases/${draft.id}`, draft);
  await mockApi(page, 'POST', `/api/v1/creator/releases/${draft.id}/publish`, (route) => {
    published = true;
    return fulfillJson(route, draft);
  });
  await page.goto(`${appUrl}/creator/releases/${draft.id}`);
  await page.getByLabel('礼物名称').fill('当前页面的新标题');
  const trigger = page.getByRole('button', { name: '发布并生成礼物单' }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '确认发布当前内容？' });
  await expect(dialog.getByRole('button', { name: '返回' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel('礼物名称')).toHaveValue('当前页面的新标题');
  expect(published).toBe(false);
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
  const order = giftOrder({
    status: 'SHIPPED',
    biliDisplayName: '已发货用户',
    release: { id: releaseId },
  });

  await mockJson(page, 'GET', '/api/v1/me', creatorIdentity());
  await mockApi(page, 'POST', '/api/v1/creator/orders/fulfillment-export', async (route) => {
    exportInput = requestJsonObject(route.request());
    await route.fulfill({
      body: 'workbook',
      headers: {
        'content-disposition': 'attachment; filename="fulfillment.xlsx"',
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x-export-row-count': '1',
      },
      status: 200,
    });
  });
  await mockJson(page, 'GET', '/api/v1/creator/orders', { items: [order], nextCursor: null });
  await mockJson(page, 'GET', '/api/v1/creator/orders/fulfillment-releases', {
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

  await page.goto(`${appUrl}/creator/orders?status=SHIPPED`);
  await expect(page.getByText('已发货用户')).toBeVisible();
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
  await expect(page).toHaveURL(`${appUrl}/creator/orders?status=SHIPPED`);
  await expect(page.getByText('已导出 1 条待发货收货信息。')).toBeVisible();
});

test('retains the form version across cover refresh and renders its preview under production CSP', async ({
  appUrl,
  page,
}) => {
  await freezeBrowserTime(page);
  let serverRelease = giftRelease({ description: '原始说明', version: 3 });
  let save: Record<string, unknown> | null = null;
  await mockJson(page, 'GET', '/api/v1/me', creatorIdentity());
  await mockJson(page, 'POST', `/api/v1/creator/releases/${serverRelease.id}/cover`, {
    coverImageUrl: null,
  });
  await mockApi(page, 'PUT', `/api/v1/creator/releases/${serverRelease.id}`, (route) => {
    save = requestJsonObject(route.request());
    return fulfillJson(
      route,
      { error: { code: 'GIFT_RELEASE_VERSION_CONFLICT', message: 'Version conflict' } },
      409,
    );
  });
  await mockApi(page, 'GET', `/api/v1/creator/releases/${serverRelease.id}`, (route) =>
    fulfillJson(route, serverRelease),
  );
  await page.goto(`${appUrl}/creator/releases/${serverRelease.id}`);
  await page.getByLabel('礼物名称').fill('我的未保存修改');
  serverRelease = { ...serverRelease, description: '其他编辑者的新说明', version: 4 };
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  const preview = page.getByAltText('待上传封面预览');
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((element) => ('naturalWidth' in element ? element.naturalWidth : null)),
    )
    .toBe(1);
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/v1/creator/releases/${serverRelease.id}`,
  );
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await refreshed;
  await expect(page.getByRole('textbox', { name: '礼物说明', exact: true })).toHaveValue(
    '原始说明',
  );
  await page.getByRole('button', { name: '保存草稿', exact: true }).first().click();
  await expect
    .poll(() => save)
    .toMatchObject({ expectedVersion: 3, description: '原始说明', title: '我的未保存修改' });
  await expect(page.getByText('礼物草稿已在其他页面被修改，请刷新后再试。')).toBeVisible();
});
