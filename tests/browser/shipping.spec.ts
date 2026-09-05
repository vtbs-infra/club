import type { CreatorOrder } from '../../src/shared/contracts/gifts.js';
import { mockApi, requestJsonObject, requestPath } from './support/api.js';
import {
  addressRecord,
  creatorIdentity,
  giftOrder,
  recipientIdentity,
  testId,
  testTime,
} from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test('ships, corrects and copies an order shipping record', async ({ appUrl, context, page }) => {
  await freezeBrowserTime(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let recipient = false;
  let current: CreatorOrder = {
    ...giftOrder({ id: testId(91), status: 'SUBMITTED', submittedAt: testTime(), version: 2 }),
    deliveryAddress: addressRecord().payload,
    optionValues: [],
  };
  const mutations: Record<string, unknown>[] = [];
  await mockApi(page, (request) => {
    const path = requestPath(request);
    if (path === '/api/v1/me') return recipient ? recipientIdentity() : creatorIdentity();
    if (path === `/api/v1/creator/orders/${current.id}/ship`) {
      const input = requestJsonObject(request);
      mutations.push(input);
      current = {
        ...current,
        status: 'SHIPPED',
        shippedAt: testTime(),
        version: 3,
        shipping: {
          carrierName: String(input.carrierName),
          trackingNumber: String(input.trackingNumber),
        },
      };
      return current;
    }
    if (path === `/api/v1/creator/orders/${current.id}/shipping`) {
      const input = requestJsonObject(request);
      mutations.push(input);
      current = {
        ...current,
        version: 4,
        shipping: {
          carrierName: String(input.carrierName),
          trackingNumber: String(input.trackingNumber),
        },
      };
      return current;
    }
    if (
      path === `/api/v1/creator/orders/${current.id}` ||
      path === `/api/v1/me/gifts/${current.id}`
    )
      return current;
    return undefined;
  });
  await page.goto(`${appUrl}/creator/orders/${current.id}`);
  await page.getByLabel('快递公司', { exact: true }).fill('中通快递');
  await page.getByLabel('运单号', { exact: true }).fill('ZT123456');
  await page.getByRole('button', { name: '确认发货', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认发货', exact: true }).click();
  await expect(page.getByRole('heading', { name: '发货信息', exact: true })).toBeVisible();
  expect(mutations[0]).toEqual({ carrierName: '中通快递', trackingNumber: 'ZT123456' });
  await expect(page.getByRole('button', { name: '标记已完成' })).toHaveCount(0);
  await page.getByRole('button', { name: '更正发货信息' }).click();
  await expect(page.getByLabel('运单号', { exact: true })).toHaveValue('ZT123456');
  await page.getByLabel('运单号', { exact: true }).fill('ZT654321');
  await page.getByRole('button', { name: '保存更正', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保存更正', exact: true }).click();
  await expect(page.getByText('ZT654321', { exact: true })).toBeVisible();
  expect(mutations[1]).toEqual({
    carrierName: '中通快递',
    trackingNumber: 'ZT654321',
    expectedVersion: 3,
  });
  recipient = true;
  await page.goto(`${appUrl}/gifts/${current.id}`);
  await expect(page.getByText('ZT654321', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制单号' }).click();
  await expect(page.getByRole('status')).toHaveText('运单号已复制');
  expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe('ZT654321');
});
