import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  buildFulfillmentWorkbook,
  safeSpreadsheetText,
} from '../../src/server/modules/gifts/fulfillment-workbook.js';

describe('fulfillment workbook', () => {
  it('neutralizes spreadsheet formulas and unsupported control characters', () => {
    expect(safeSpreadsheetText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(safeSpreadsheetText('+cmd')).toBe("'+cmd");
    expect(safeSpreadsheetText('普通文本\u0001尾部')).toBe('普通文本 尾部');
  });

  it('builds a machine-friendly workbook from frozen fulfillment data', async () => {
    const content = await buildFulfillmentWorkbook({
      creatorDisplayName: '测试主播',
      eligibilityMonth: '2026-06-01',
      fields: [
        { key: 'color', label: '颜色' },
        { key: 'signed', label: '需要签名' },
      ],
      generatedAt: new Date('2026-07-01T04:00:00.000Z'),
      releaseTitle: '六月纪念礼物',
      rows: [
        {
          address: {
            city: '上海市',
            countryRegion: '中国大陆',
            detailedAddress: '=测试路 1 号',
            district: '浦东新区',
            phone: '013800138000',
            postalCode: '020000',
            province: '上海市',
            recipientName: '+收件人',
            userNote: '工作日送达',
          },
          biliDisplayName: '@昵称',
          biliUid: '0011001',
          optionValues: { color: '蓝色', signed: true },
          orderNumber: 'G202607-00000000000000000000000000000005',
          packages: [
            {
              items: [{ name: '徽章', quantity: 1 }],
              name: '舰长礼包',
            },
          ],
          submittedAt: new Date('2026-06-30T08:00:00.000Z'),
          tier: 'CAPTAIN',
        },
      ],
      timezone: 'Asia/Shanghai',
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('待发货清单');
    expect(sheet).toBeDefined();
    expect(sheet!.getCell('A1').value).toBe('礼物单号');
    expect(sheet!.getCell('R1').value).toBe('颜色');
    expect(sheet!.getCell('S1').value).toBe('需要签名');
    expect(sheet!.getCell('B2').value).toBe("'+收件人");
    expect(sheet!.getCell('C2').value).toBe('013800138000');
    expect(sheet!.getCell('H2').value).toBe("'=测试路 1 号");
    expect(sheet!.getCell('J2').value).toBe('020000');
    expect(sheet!.getCell('L2').value).toBe('0011001');
    expect(sheet!.getCell('M2').value).toBe("'@昵称");
    expect(sheet!.getCell('O2').value).toBe('舰长礼包：徽章 × 1');
    expect(sheet!.getCell('R2').value).toBe('蓝色');
    expect(sheet!.getCell('S2').value).toBe('是');
    expect(workbook.getWorksheet('导出说明')?.getCell('B5').value).toBe('1');
  });
});
