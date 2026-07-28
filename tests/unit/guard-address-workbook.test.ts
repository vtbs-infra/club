import ExcelJS from '@excel.js/exceljs';
import { describe, expect, it } from 'vitest';

import { buildGuardAddressWorkbook } from '../../src/server/modules/fulfillment/guard-address-workbook.js';

describe('current-month guard address workbook', () => {
  it('creates a styled, filterable workbook with text-safe recipient fields', async () => {
    const content = await buildGuardAddressWorkbook({
      creatorDisplayName: '测试主播',
      generatedAt: new Date('2026-07-28T04:00:00.000Z'),
      periodStart: '2026-07-01',
      rows: [
        {
          address: {
            city: '上海市',
            countryRegion: '中国',
            detailedAddress: '+恶意公式路 1 号',
            district: '浦东新区',
            phone: '13800138000',
            postalCode: '200000',
            province: '上海市',
            recipientName: '@收件人',
            userNote: '=HYPERLINK("https://example.test")',
          },
          biliUid: '12345678901234567890',
          claimNumber: 'CLM-2026-00000001',
          claimStatus: 'PROCESSING',
          displayName: '=SUM(1,1)',
          tier: 'ADMIRAL',
        },
      ],
      timezone: 'Asia/Shanghai',
    });

    expect(content.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const worksheet = workbook.getWorksheet('当月舰长');

    expect(worksheet).toBeDefined();
    expect(worksheet!.getCell('A1').value).toContain('测试主播');
    expect(worksheet!.getCell('A4').value).toBe('UID');
    expect(worksheet!.getCell('A5').value).toBe('12345678901234567890');
    expect(worksheet!.getCell('A5').numFmt).toBe('@');
    expect(worksheet!.getCell('B5').value).toBe("'=SUM(1,1)");
    expect(worksheet!.getCell('C5').value).toBe('提督');
    expect(worksheet!.getCell('D5').value).toBe("'@收件人");
    expect(worksheet!.getCell('J5').value).toBe("'+恶意公式路 1 号");
    expect(worksheet!.getCell('L5').value).toContain('浦东新区');
    expect(worksheet!.getCell('M5').value).toBe(`'=HYPERLINK("https://example.test")`);
    expect(worksheet!.autoFilter).toEqual('A4:O4');
    expect(worksheet!.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
  });

  it('returns a usable workbook with an explicit empty-state message', async () => {
    const content = await buildGuardAddressWorkbook({
      creatorDisplayName: 'Empty Creator',
      generatedAt: new Date('2026-07-28T04:00:00.000Z'),
      periodStart: '2026-07-01',
      rows: [],
      timezone: 'UTC',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    expect(workbook.getWorksheet('当月舰长')!.getCell('A5').value).toBe(
      '本月暂无已领取且包含有效冻结地址的舰长记录。',
    );
  });
});
