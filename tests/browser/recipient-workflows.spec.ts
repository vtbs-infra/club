import { mockApi, requestJsonObject, requestPath } from './support/api.js';
import {
  addressRecord,
  announcement,
  bilibiliBinding,
  giftOrder,
  recipientIdentity,
  testId,
  testTime,
} from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('lands a recipient on the mobile dashboard', async ({ appUrl, page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return recipientIdentity();
    if (pathname === '/api/v1/me/gifts') return [giftOrder()];
    if (pathname === '/api/v1/me/announcements') return [announcement()];
    if (pathname === '/api/v1/me/bilibili-binding') return bilibiliBinding();
    if (pathname === '/api/v1/me/addresses') return [];
    return undefined;
  });

  await page.goto(`${appUrl}/dashboard`);
  await expect(page.getByRole('heading', { name: '欢迎回来，测试用户！' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '近期资讯' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '七月舰长礼物' })).toBeVisible();
  await expect(page.getByText('先保存一个收货地址')).toBeVisible();

  const accountTrigger = page.getByRole('button', { name: '测试用户的账号菜单' });
  await accountTrigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '账号', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'B站绑定' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(accountTrigger).toBeFocused();

  await page.goto(`${appUrl}/gifts`);
  const giftFilters = page.getByRole('group', { name: '按礼物状态筛选' });
  await expect(giftFilters).toBeVisible();
  await expect(giftFilters.getByRole('button', { name: '全部' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await giftFilters.getByRole('button', { name: '待领取' }).click();
  await expect(giftFilters.getByRole('button', { name: '待领取' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: '七月舰长礼物' })).toBeVisible();
});

test('uses the default address and real radio choice when claiming a gift', async ({
  appUrl,
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const giftOrderId = testId(20);
  const defaultAddressId = testId(26);
  let submitted = false;
  let submission: Record<string, unknown> | null = null;
  const currentGift = () =>
    giftOrder({
      id: giftOrderId,
      orderNumber: 'G202607-CLAIM001',
      release: {
        description: '默认地址领取测试',
        formFields: [
          {
            key: 'size',
            label: '尺码',
            options: ['M', 'L'],
            required: true,
            type: 'RADIO',
          },
        ],
        id: testId(23),
      },
      status: submitted ? 'SUBMITTED' : 'CLAIMABLE',
      submittedAt: submitted ? testTime() : null,
      version: submitted ? 2 : 1,
    });
  const addresses = [
    addressRecord(),
    addressRecord({
      createdAt: testTime(-1),
      id: defaultAddressId,
      isDefault: true,
      label: '家',
      payload: {
        city: '杭州市',
        countryRegion: '中国大陆',
        detailedAddress: '默认路 2 号',
        district: '西湖区',
        phone: '13800138002',
        postalCode: '310000',
        province: '浙江省',
        recipientName: '默认收件人',
        userNote: '',
      },
      updatedAt: testTime(-1),
    }),
  ];

  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return recipientIdentity({ id: testId(24) });
    if (pathname === '/api/v1/me/addresses') return addresses;
    if (pathname === `/api/v1/me/gifts/${giftOrderId}/submit`) {
      submission = requestJsonObject(request);
      submitted = true;
      return currentGift();
    }
    if (pathname === `/api/v1/me/gifts/${giftOrderId}`) return currentGift();
    return undefined;
  });

  await page.goto(`${appUrl}/gifts/${giftOrderId}`);
  const addressRadios = page.getByRole('radio', { name: /办公室|家/ });
  await expect(addressRadios).toHaveCount(2);
  await expect(addressRadios.nth(1)).toBeChecked();
  await expect(page.getByText('默认收件人', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'L' }).check();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认领取礼物' }).click();

  await expect.poll(() => submission).not.toBeNull();
  expect(submission).toEqual({
    addressId: defaultAddressId,
    expectedVersion: 1,
    options: { size: 'L' },
  });
  await expect(page.getByRole('heading', { name: '礼物进度' })).toBeVisible();
});
