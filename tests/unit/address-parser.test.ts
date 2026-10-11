import { describe, expect, it } from 'vitest';

import { addressRegions, isKnownRegion, recognizeAddress } from '../../src/web/lib/address-parser';

describe('local mainland address recognition', () => {
  it.each([
    '张三 13800138000 浙江省杭州市西湖区文三路88号2幢301室',
    '浙江省杭州市西湖区文三路88号2幢301室，张三，13800138000',
    '张三13800138000浙江杭州西湖文三路88号2幢301室',
  ])('extracts a common single-address layout: %s', (input) => {
    expect(recognizeAddress(input)).toEqual({
      recipientName: '张三',
      phones: ['13800138000'],
      postalCode: '',
      userNote: '',
      candidates: [
        {
          province: '浙江省',
          city: '杭州市',
          district: '西湖区',
          detailedAddress: '文三路88号2幢301室',
        },
      ],
    });
  });

  it('reads labeled multiline text, full-width phone digits and an explicit postal code', () => {
    expect(
      recognizeAddress(
        '收件人：Alice 🐱\n手机：＋８６ １３８００１３８０００\n所在地区：上海市浦东新区\n详细地址：张江路88号A座12/03室\n邮编：200120\n备注：请电话联系',
      ),
    ).toEqual({
      recipientName: 'Alice 🐱',
      phones: ['13800138000'],
      postalCode: '200120',
      userNote: '请电话联系',
      candidates: [
        {
          province: '上海市',
          city: '上海市',
          district: '浦东新区',
          detailedAddress: '张江路88号A座12/03室',
        },
      ],
    });
  });

  it('preserves six-digit room numbers and street names that resemble other regions', () => {
    const result = recognizeAddress('张三 13800138000 江苏省南京市鼓楼区上海路100201室');
    expect(result?.postalCode).toBe('');
    expect(result?.candidates).toEqual([
      { province: '江苏省', city: '南京市', district: '鼓楼区', detailedAddress: '上海路100201室' },
    ]);
  });

  it.each(['区女士', '用户123'])('reads space-separated labels and a labeled name: %s', (name) => {
    const result = recognizeAddress(
      `收货人 ${name} 手机号码 13800138000 所在地区 浙江省杭州市西湖区 详细地址 文三路88号`,
    );
    expect(result?.recipientName).toBe(name);
    expect(result?.phones).toEqual(['13800138000']);
    expect(result?.candidates).toEqual([
      { province: '浙江省', city: '杭州市', district: '西湖区', detailedAddress: '文三路88号' },
    ]);
  });

  it('keeps the separator before a landline extension', () => {
    expect(
      recognizeAddress('收件人：张三 电话：0571-88888888-123 地址：浙江省杭州市西湖区文三路88号')
        ?.phones,
    ).toEqual(['0571-88888888-123']);
  });

  it('keeps township and village information in the detail', () => {
    expect(
      recognizeAddress('李四 13800138000 北京市朝阳区望京街道测试村三组6号')?.candidates,
    ).toEqual([
      {
        province: '北京市',
        city: '北京市',
        district: '朝阳区',
        detailedAddress: '望京街道测试村三组6号',
      },
    ]);
  });

  it('returns all matching regions instead of choosing an ambiguous district', () => {
    const result = recognizeAddress('王五 13800138000 朝阳区测试路1号');
    expect(result?.candidates.map((candidate) => candidate.city).sort()).toEqual([
      '北京市',
      '长春市',
    ]);
    expect(result?.candidates.every((candidate) => candidate.detailedAddress === '测试路1号')).toBe(
      true,
    );
  });

  it('returns phone choices and does not duplicate the same number', () => {
    expect(
      recognizeAddress('张三 13800138000 +86 13800138000 13900000000 上海市浦东新区测试路8号')
        ?.phones,
    ).toEqual(['13800138000', '13900000000']);
  });

  it('leaves masked phone numbers empty for manual completion', () => {
    const result = recognizeAddress('张三 138****8000 浙江省杭州市西湖区测试路8号');
    expect(result?.phones).toEqual([]);
    expect(result?.candidates[0]?.detailedAddress).toBe('测试路8号');
  });

  it.each([
    {
      input: '王五 13900000000 广东省东莞市南城街道测试路3号',
      province: '广东省',
      city: '东莞市',
      detailedAddress: '南城街道测试路3号',
    },
    {
      input: '王五 13900000000 海南省琼海市嘉积镇测试路3号',
      province: '海南省',
      city: '琼海市',
      detailedAddress: '嘉积镇测试路3号',
    },
  ])('handles a city without a district: $city', ({ input, ...address }) => {
    expect(recognizeAddress(input)?.candidates).toEqual([{ ...address, district: '' }]);
  });

  it('does not fabricate a city when only a province is present', () => {
    expect(recognizeAddress('张三 13800138000 浙江省测试路3号')?.candidates).toEqual([
      { province: '浙江省', city: '', district: '', detailedAddress: '测试路3号' },
    ]);
  });

  it('accepts partial contact information for manual address completion', () => {
    expect(recognizeAddress('收件人：张三 手机：13800138000')?.candidates).toEqual([
      { province: '', city: '', district: '', detailedAddress: '' },
    ]);
  });

  it('rejects unrelated, oversized and multiple-address input', () => {
    for (const input of [
      '',
      'hello',
      '请帮我处理一下',
      '广'.repeat(2001),
      '收件人：张三 手机：13800138000 收件人：李四 手机：13900000000',
      '张三 13800138000 浙江省杭州市西湖区文三路88号\n李四 13900000000 江苏省南京市鼓楼区上海路8号',
    ]) {
      expect(recognizeAddress(input)).toBeNull();
    }
  });

  it('uses one consistent selectable hierarchy for mainland regions', () => {
    expect(addressRegions).toHaveLength(31);
    const chongqing = addressRegions.find((region) => region.name === '重庆市')!;
    expect(chongqing.children).toHaveLength(1);
    expect(chongqing.children[0]?.children.some((region) => region.name === '城口县')).toBe(true);
    expect(isKnownRegion({ province: '浙江省', city: '杭州市', district: '西湖区' })).toBe(true);
    expect(isKnownRegion({ province: '浙江省', city: '南京市', district: '鼓楼区' })).toBe(false);
    expect(isKnownRegion({ province: '广东省', city: '东莞市', district: '' })).toBe(true);
  });
});
