import readExcelFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';

import { buildFulfillmentWorkbook } from '../../src/server/modules/gifts/fulfillment-workbook.js';

describe('fulfillment workbook', () => {
  it('preserves fulfillment fields and identifiers as literal text in a single worksheet', async () => {
    const content = await buildFulfillmentWorkbook({
      fields: [
        { key: 'color', label: '颜色' },
        { key: 'signed', label: '需要签名' },
      ],
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
            userNote: '工作日送达\n请先联系',
          },
          biliDisplayName: '@昵称',
          biliUid: '3493095194757549',
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

    const sheets = await readExcelFile(content, { trim: false });
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.data).toHaveLength(2);
    const [headers, row] = sheets[0]!.data;
    const values = Object.fromEntries(
      headers!.map((header, index) => [String(header), row![index]]),
    );
    expect(values).toMatchObject({
      礼物单号: 'G202607-00000000000000000000000000000005',
      收件人: '+收件人',
      手机号: '013800138000',
      详细地址: '=测试路 1 号',
      邮编: '020000',
      地址备注: '工作日送达\n请先联系',
      'B站 UID': '3493095194757549',
      B站昵称: '@昵称',
      礼包及礼物内容: '舰长礼包：徽章 × 1',
      颜色: '蓝色',
      需要签名: '是',
    });
  });
});
