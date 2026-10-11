import type { Page } from '@playwright/test';

import type { AddressRecord } from '../../src/shared/contracts/addresses.js';
import { fulfillJson, mockApi, mockJson, requestJsonObject } from './support/api.js';
import { addressRecord, giftOrder, recipientIdentity, testId } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

async function openAddressForm(page: Page, appUrl: string) {
  await mockJson(page, 'GET', '/api/v1/me', recipientIdentity());
  await mockJson(page, 'GET', '/api/v1/me/addresses', []);
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await expect(page.getByRole('button', { name: '识别地址', exact: true })).toBeVisible();
}

test('recognizes locally on mobile, permits correction and saves only after confirmation', async ({
  appUrl,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAddressForm(page, appUrl);
  const requests: Record<string, unknown>[] = [];
  let saved: AddressRecord[] = [];
  await mockApi(page, 'GET', '/api/v1/me/addresses', (route) => fulfillJson(route, saved));
  await mockApi(page, 'POST', '/api/v1/me/addresses', (route) => {
    const body = requestJsonObject(route.request());
    requests.push(body);
    const record = addressRecord({
      label: String(body.label),
      payload: body.payload as AddressRecord['payload'],
    });
    saved = [record];
    return fulfillJson(route, record, 201);
  });
  const outgoing: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(appUrl).origin) outgoing.push(request.url());
  });
  await page.getByLabel(/粘贴收货信息/).fill('张三 13800138000 浙江省杭州市西湖区文三路100201室');
  await page.getByRole('button', { name: '识别地址', exact: true }).click();
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('张三');
  await expect(page.getByLabel('省 / 直辖市', { exact: true })).toHaveValue('浙江省');
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('杭州市');
  await expect(page.getByLabel('区 / 县', { exact: true })).toHaveValue('西湖区');
  await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue('文三路100201室');
  await expect(page.getByLabel('邮政编码', { exact: true })).toHaveValue('');
  expect(requests).toEqual([]);
  expect(outgoing).toEqual([]);
  await page.getByLabel('详细地址', { exact: true }).fill('文三路100201室（东门）');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: testInfo.outputPath('address-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '保存并使用' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    payload: {
      recipientName: '张三',
      phone: '13800138000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detailedAddress: '文三路100201室（东门）',
    },
  });
  expect(requests[0]).not.toHaveProperty('text');
  await expect(page.getByRole('button', { name: '识别地址', exact: true })).toHaveCount(0);
});

test('requires choices for ambiguous regions and multiple phones', async ({ appUrl, page }) => {
  await openAddressForm(page, appUrl);
  await page
    .getByLabel(/粘贴收货信息/)
    .fill('张三 13800138000 13900000000 朝阳区望京街道测试路1号');
  await page.getByRole('button', { name: '识别地址', exact: true }).click();
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '使用此识别结果' })).toBeDisabled();
  await page.getByRole('radio', { name: '北京市 / 北京市 / 朝阳区' }).check();
  await expect(page.getByRole('button', { name: '使用此识别结果' })).toBeDisabled();
  await page.getByRole('radio', { name: '13900000000' }).check();
  await page.getByRole('button', { name: '使用此识别结果' }).click();
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('北京市');
  await expect(page.getByLabel('手机号码', { exact: true })).toHaveValue('13900000000');
  await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue('望京街道测试路1号');
});

test('retains oversized pasted details and asks for correction before saving', async ({
  appUrl,
  page,
}) => {
  await openAddressForm(page, appUrl);
  const detail = `文三路${'楼'.repeat(500)}1号`;
  await page.getByLabel(/粘贴收货信息/).fill(`张三 13800138000 浙江省杭州市西湖区${detail}`);
  await page.getByRole('button', { name: '识别地址', exact: true }).click();
  await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue(detail);
  await page.getByRole('button', { name: '保存并使用' }).click();
  await expect(page.getByText('详细地址不能超过 500 个字符，请修改后保存。')).toBeVisible();
  await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue(detail);
});

test('preserves edits until replacement is confirmed and clears missing fields', async ({
  appUrl,
  page,
}) => {
  await openAddressForm(page, appUrl);
  await page.getByLabel('地址名称', { exact: true }).fill('家');
  await page.getByLabel('收件人', { exact: true }).fill('原收件人');
  await page.getByLabel('手机号码', { exact: true }).fill('13900000000');
  await page.getByLabel('配送备注', { exact: true }).fill('保留的备注');
  await page.getByLabel(/粘贴收货信息/).fill('张三 138****8000 上海市浦东新区张江路8号');
  await page.getByRole('button', { name: '识别地址', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '返回' }).click();
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('原收件人');
  await page.getByRole('button', { name: '识别地址', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '替换并核对' }).click();
  await expect(page.getByLabel('地址名称', { exact: true })).toHaveValue('家');
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('张三');
  await expect(page.getByLabel('手机号码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('配送备注', { exact: true })).toHaveValue('保留的备注');
  await expect(page.getByText(/请补充手机号码/)).toBeVisible();
});

test('searches regions with the keyboard, clears dependent choices and supports manual regions', async ({
  appUrl,
  page,
}) => {
  await openAddressForm(page, appUrl);
  const province = page.getByRole('combobox', { name: '省 / 直辖市', exact: true });
  await province.fill('浙江');
  await province.press('ArrowDown');
  await province.press('Enter');
  const city = page.getByRole('combobox', { name: '城市', exact: true });
  await city.fill('杭州');
  await city.press('Enter');
  const district = page.getByRole('combobox', { name: '区 / 县', exact: true });
  await district.fill('西湖');
  await district.press('Enter');
  await province.fill('江苏');
  await province.press('Enter');
  await expect(city).toHaveValue('');
  await expect(district).toHaveValue('');
  await expect(district).toBeDisabled();
  await page.getByRole('button', { name: '手动填写地区' }).click();
  await page.getByLabel('城市', { exact: true }).fill('历史城市名称');
  await page.getByLabel('区 / 县', { exact: true }).fill('新设区');
  await page.getByLabel('国家或地区', { exact: true }).fill('新加坡');
  await expect(page.getByRole('button', { name: '识别地址', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('历史城市名称');
});

test('keeps manual entry available if the local parser cannot load', async ({ appUrl, page }) => {
  await mockJson(page, 'GET', '/api/v1/me', recipientIdentity());
  await mockJson(page, 'GET', '/api/v1/me/addresses', []);
  await page.route('**/assets/address-parser-*.js', (route) => route.abort());
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await expect(page.getByText('地址识别与地区列表暂时不可用，请手动填写。')).toBeVisible();
  await page.getByLabel('省 / 直辖市', { exact: true }).fill('浙江省');
  await expect(page.getByLabel('省 / 直辖市', { exact: true })).toHaveValue('浙江省');
});

test('saving an inline address never submits the gift and selects the new address', async ({
  appUrl,
  page,
}) => {
  await freezeBrowserTime(page);
  const order = giftOrder({ release: { formFields: [] } });
  let addresses = [addressRecord({ isDefault: true })];
  let saves = 0;
  let claims = 0;
  await mockJson(page, 'GET', '/api/v1/me', recipientIdentity());
  await mockJson(page, 'GET', `/api/v1/me/gifts/${order.id}`, order);
  await mockApi(page, 'GET', '/api/v1/me/addresses', (route) => fulfillJson(route, addresses));
  await mockApi(page, 'POST', '/api/v1/me/addresses', (route) => {
    saves += 1;
    const body = requestJsonObject(route.request());
    const record = addressRecord({
      id: testId(99),
      label: '新地址',
      payload: body.payload as AddressRecord['payload'],
    });
    addresses = [...addresses, record];
    return fulfillJson(route, record, 201);
  });
  await mockApi(page, 'POST', `/api/v1/me/gifts/${order.id}/submit`, (route) => {
    claims += 1;
    return fulfillJson(route, order);
  });
  await page.goto(`${appUrl}/gifts/${order.id}`);
  await page.getByRole('button', { name: '添加新地址', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /我已核对/ })).toBeDisabled();
  await page.getByLabel(/粘贴收货信息/).fill('李四 13900000000 浙江省杭州市西湖区测试路8号');
  await page.getByRole('button', { name: '识别地址', exact: true }).click();
  await expect(page.locator('form form')).toHaveCount(0);
  expect(saves).toBe(0);
  expect(claims).toBe(0);
  await page.getByRole('button', { name: '保存并使用' }).click();
  await expect(page.getByRole('radio', { name: /新地址/ })).toBeChecked();
  expect(saves).toBe(1);
  expect(claims).toBe(0);
  await expect(page.getByRole('button', { name: '确认领取礼物' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /我已核对/ }).check();
  await page.getByRole('button', { name: '确认领取礼物' }).click();
  await expect.poll(() => claims).toBe(1);
});
