import { readFile } from 'node:fs/promises';

import { expect, test } from './support/test.js';

test('serves the built license text publicly instead of the SPA shell', async ({
  appUrl,
  page,
}) => {
  const expected = await readFile('src/web/public/third-party-notices.txt', 'utf8');
  const response = await page.goto(`${appUrl}/third-party-notices.txt`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toBe('text/plain; charset=utf-8');
  expect(response?.headers()['cache-control']).toBe('no-cache');
  expect(await response?.text()).toBe(expected);
  await expect(page.locator('body')).toContainText('@vant/area-data 2.1.0');
  await expect(page.locator('body')).toContainText('MIT License');
  await expect(page.locator('#root')).toHaveCount(0);
});
