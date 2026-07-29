import { describe, expect, it } from 'vitest';

import {
  buildGuardAddressWorkbook,
  safeSpreadsheetText,
} from '../../src/server/modules/gifts/guard-address-workbook.js';

describe('guard address workbook', () => {
  it('neutralizes spreadsheet formulas and invalid control characters', () => {
    expect(safeSpreadsheetText('=HYPERLINK("https://example.com")')).toBe(
      '\'=HYPERLINK("https://example.com")',
    );
    expect(safeSpreadsheetText('+SUM(1,1)')).toBe("'+SUM(1,1)");
    expect(safeSpreadsheetText('@command')).toBe("'@command");
    expect(safeSpreadsheetText('safe\u0007value')).toBe('safe value');
  });

  it('creates an Excel workbook with frozen fulfillment data', async () => {
    const content = await buildGuardAddressWorkbook({
      creatorDisplayName: '测试主播',
      generatedAt: new Date('2026-06-20T08:00:00.000Z'),
      periodStart: '2026-06-01',
      rows: [
        {
          address: {
            city: '上海市',
            countryRegion: '中国大陆',
            detailedAddress: '=危险公式',
            district: '浦东新区',
            phone: '13800138000',
            postalCode: '200000',
            province: '上海市',
            recipientName: '测试收件人',
            userNote: '',
          },
          biliUid: '001234567890',
          displayName: '测试舰长',
          orderNumber: 'GIFT-202606-0001',
          orderStatus: 'COMPLETED',
          tier: 'CAPTAIN',
        },
      ],
      timezone: 'Asia/Shanghai',
    });

    expect(content.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(content.byteLength).toBeGreaterThan(5_000);
  });
});
