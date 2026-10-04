import type { Page } from '@playwright/test';

import type { AddressRecord } from '../../src/shared/contracts/addresses.js';
import { fulfillJson, mockApi, mockJson, requestJsonObject } from './support/api.js';
import { addressRecord, giftOrder, recipientIdentity } from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

const copied = '张三，13800138000，浙江省杭州市西湖区文三路88号2幢1单元502室';
const expectedPayload = {
  city: '杭州市',
  countryRegion: '中国大陆',
  detailedAddress: '文三路88号2幢1单元502室',
  district: '西湖区',
  phone: '13800138000',
  postalCode: '',
  province: '浙江省',
  recipientName: '张三',
  userNote: '',
};

async function paste(page: Page, value = copied) {
  await page.getByLabel('粘贴整条地址', { exact: true }).evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, value);
}

async function setup(page: Page, existing: AddressRecord[] = []) {
  let addresses = existing;
  const writes: Record<string, unknown>[] = [];
  await mockJson(page, 'GET', '/api/v1/me', recipientIdentity());
  await mockApi(page, 'GET', '/api/v1/me/addresses', (route) => fulfillJson(route, addresses));
  await mockApi(page, 'POST', '/api/v1/me/addresses', (route) => {
    writes.push(requestJsonObject(route.request()));
    const record = addressRecord({ isDefault: true, label: '常用地址', payload: expectedPayload });
    addresses = [...addresses, record];
    return fulfillJson(route, record, 201);
  });
  return writes;
}

test('fills an empty address on paste, supports undo and only persists after Save', async ({
  appUrl,
  page,
}, testInfo) => {
  const writes = await setup(page);
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await expect(page.getByLabel('粘贴整条地址', { exact: true })).toBeFocused();
  await paste(page);
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('张三');
  await expect(page.getByLabel('省 / 直辖市', { exact: true })).toHaveValue('浙江省');
  await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue(
    expectedPayload.detailedAddress,
  );
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: '撤销本次填入' }).click();
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('');
  await paste(page);
  await expect(page.getByLabel('手机号码', { exact: true })).toHaveValue('13800138000');
  await page.getByRole('region', { name: '整条地址识别' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('address-paste-desktop.png'), fullPage: true });
  expect(writes).toEqual([]);
  const storage = await page.evaluate(() =>
    [localStorage, sessionStorage]
      .flatMap((store) =>
        Array.from({ length: store.length }, (_, index) => store.getItem(store.key(index)!)),
      )
      .join('\n'),
  );
  expect(storage).not.toContain('13800138000');
  await page.getByRole('button', { name: '保存并使用' }).click();
  await expect
    .poll(() => writes)
    .toEqual([{ label: '常用地址', isDefault: true, payload: expectedPayload }]);
  await expect(page.getByLabel('粘贴整条地址', { exact: true })).toHaveCount(0);
});

test('previews replacement of an existing address and restores all fields on undo', async ({
  appUrl,
  page,
}) => {
  const original = addressRecord({ isDefault: true });
  const writes = await setup(page, [original]);
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await paste(page);
  await expect(page.getByRole('button', { name: '确认替换表单' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue(
    original.payload.recipientName,
  );
  await page.getByRole('button', { name: '不应用', exact: true }).click();
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('上海市');
  await paste(page);
  await page.getByRole('button', { name: '确认替换表单' }).click();
  await expect(page.getByLabel('邮政编码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('地址名称', { exact: true })).toHaveValue(original.label);
  await expect(page.getByLabel('设为默认地址', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '撤销本次填入' }).click();
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue(
    original.payload.recipientName,
  );
  await expect(page.getByLabel('邮政编码', { exact: true })).toHaveValue(
    original.payload.postalCode,
  );
  expect(writes).toEqual([]);
});

test('does not keep an old phone when applying an incomplete new address', async ({
  appUrl,
  page,
}) => {
  const writes = await setup(page, [addressRecord()]);
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await paste(page, '收件人：张三 电话：138****8000 地址：浙江省杭州市西湖区测试路88号');
  await expect(page.getByText('手机号含有隐藏字符，无法还原，请填写完整联系电话。')).toBeVisible();
  await page.getByRole('button', { name: '确认替换表单' }).click();
  await expect(page.getByLabel('手机号码', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  expect(writes).toEqual([]);
  expect(
    await page
      .getByLabel('手机号码', { exact: true })
      .evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
  ).toBe(true);
});

test('rejects repeated full-address labels without filling or saving a combined address', async ({
  appUrl,
  page,
}) => {
  const writes = await setup(page);
  const ambiguous =
    '收件人：张三\n电话：13800138000\n收货地址：上海市浦东新区测试路1号\n收货地址：浦东新区测试路2号';
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await paste(page, ambiguous);
  await expect(page.getByText(/检测到重复或冲突的地址标签/)).toBeVisible();
  await expect(page.getByLabel('粘贴整条地址', { exact: true })).toHaveValue(ambiguous);
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '确认替换表单' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销本次填入' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const tail of ['工作日送货', '周末有人', '张三']) {
  test(`previews uncertain trailing text without inventing a recipient: ${tail}`, async ({
    appUrl,
    page,
  }) => {
    const writes = await setup(page);
    await page.goto(`${appUrl}/account/addresses`);
    await page.getByRole('button', { name: '添加地址', exact: true }).click();
    await paste(page, `13800138000，上海市浦东新区测试路1号，${tail}`);
    await expect(page.getByText(/无法确定地址尾部文字是否为收件人/)).toBeVisible();
    await expect(page.getByRole('button', { name: '确认替换表单' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存并使用', exact: true })).toBeDisabled();
    await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue('');
    expect(writes).toEqual([]);
    await page.getByRole('button', { name: '确认替换表单' }).click();
    await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue(`测试路1号，${tail}`);
    await page.getByRole('button', { name: '保存并使用', exact: true }).click();
    expect(
      await page
        .getByLabel('收件人', { exact: true })
        .evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
    ).toBe(true);
    expect(writes).toEqual([]);
  });
}

for (const [format, text] of [
  ['labeled', '收件人：张三\n电话：13800138000\n地址：上海市浦东新区测试路13800138000号'],
  ['unlabeled', '张三，上海市浦东新区测试路13800138000号，13800138000'],
] as const) {
  test(`preserves door digits identical to the phone in ${format} input`, async ({
    appUrl,
    page,
  }) => {
    const writes = await setup(page);
    await page.goto(`${appUrl}/account/addresses`);
    await page.getByRole('button', { name: '添加地址', exact: true }).click();
    await paste(page, text);
    await expect(page.getByLabel('手机号码', { exact: true })).toHaveValue('13800138000');
    await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue('测试路13800138000号');
    await expect(page.getByRole('button', { name: '确认替换表单' })).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

test('never erases subsequent manual edits when offering undo', async ({ appUrl, page }) => {
  await setup(page);
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await paste(page);
  await expect(page.getByRole('button', { name: '撤销本次填入' })).toBeVisible();
  await page.getByLabel('详细地址', { exact: true }).fill('我手动修改的门牌号');
  await expect(page.getByRole('button', { name: '撤销本次填入' })).toHaveCount(0);
  await paste(page);
  await page.getByRole('button', { name: '不应用', exact: true }).click();
  await expect(page.getByLabel('详细地址', { exact: true })).toHaveValue('我手动修改的门牌号');
});

test('supports mobile gift-claim entry without submitting the gift', async ({
  appUrl,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await setup(page);
  const order = giftOrder({
    release: {
      formFields: [
        { key: 'color', label: '颜色', type: 'SELECT', required: true, options: ['蓝色', '粉色'] },
      ],
    },
  });
  await mockJson(page, 'GET', `/api/v1/me/gifts/${order.id}`, order);
  await page.goto(`${appUrl}/gifts/${order.id}`);
  await page.getByRole('button', { name: '添加新地址', exact: true }).click();
  await paste(page);
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('张三');
  await page.getByRole('region', { name: '整条地址识别' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('address-paste-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '保存并使用' }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByRole('radio', { name: /常用地址/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /我已核对礼物/ }).check();
  await page.getByRole('button', { name: '确认领取礼物', exact: true }).click();
  expect(
    await page
      .getByRole('combobox', { name: /颜色/ })
      .evaluate((element) => (element as HTMLSelectElement).validity.valueMissing),
  ).toBe(true);
  // A gift submission would be an unmocked API request and fail the fixture.
});

test('reads the clipboard only after an explicit click', async ({ appUrl, context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await page.evaluate((value) => navigator.clipboard.writeText(value), copied);
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '从剪贴板粘贴', exact: true }).click();
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('张三');
});

test('falls back to manual paste when clipboard permission is denied', async ({ appUrl, page }) => {
  await setup(page);
  await page.goto(`${appUrl}/account/addresses`);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
      configurable: true,
    }),
  );
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await page.getByRole('button', { name: '从剪贴板粘贴', exact: true }).click();
  await expect(page.getByText(/无法读取剪贴板/)).toBeVisible();
  await paste(page);
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('张三');
});

test('does not overwrite manual edits made while the parser chunk is loading', async ({
  appUrl,
  page,
}) => {
  await setup(page);
  const ready = Promise.withResolvers<void>();
  let requested = false;
  await page.route(/\/assets\/address-parser-.*\.js$/, async (route) => {
    requested = true;
    await ready.promise;
    await route.continue();
  });
  try {
    await page.goto(`${appUrl}/account/addresses`);
    await page.getByRole('button', { name: '添加地址', exact: true }).click();
    await paste(page);
    await expect.poll(() => requested).toBe(true);
    await page.getByLabel('收件人', { exact: true }).fill('保留手动填写');
    ready.resolve();
    await expect(page.getByRole('button', { name: '确认替换表单' })).toBeVisible();
    await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('保留手动填写');
  } finally {
    ready.resolve();
  }
});

test('ignores stale recognition after the user changes the source text', async ({
  appUrl,
  page,
}) => {
  await setup(page);
  const ready = Promise.withResolvers<void>();
  let requested = false;
  await page.route(/\/assets\/address-parser-.*\.js$/, async (route) => {
    requested = true;
    await ready.promise;
    await route.continue();
  });
  try {
    await page.goto(`${appUrl}/account/addresses`);
    await page.getByRole('button', { name: '添加地址', exact: true }).click();
    await paste(page);
    await expect.poll(() => requested).toBe(true);
    await page.getByLabel('粘贴整条地址', { exact: true }).fill('新的原文');
    ready.resolve();
    await page.getByRole('button', { name: '重新识别', exact: true }).click();
    await expect(page.getByText(/未能安全识别/)).toBeVisible();
    await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('');
  } finally {
    ready.resolve();
  }
});

test('does not truncate oversized pasted content or mutate the current form', async ({
  appUrl,
  page,
}) => {
  await setup(page);
  await page.goto(`${appUrl}/account/addresses`);
  await page.getByRole('button', { name: '添加地址', exact: true }).click();
  await page.getByLabel('收件人', { exact: true }).fill('手填姓名');
  await paste(page, copied.repeat(100));
  await expect(page.getByText(/整条地址不能超过 2000 个字符/)).toBeVisible();
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('手填姓名');
  await expect(page.getByRole('button', { name: '确认替换表单' })).toHaveCount(0);
});
