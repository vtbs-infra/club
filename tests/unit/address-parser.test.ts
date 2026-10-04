import { describe, expect, it } from 'vitest';

import {
  ADDRESS_TEXT_LIMIT,
  EMPTY_ADDRESS,
  hasAddressContent,
} from '../../src/web/lib/address-fields';
import { parseAddress } from '../../src/web/lib/address-parser';

const hangzhou = {
  recipientName: '张三',
  phone: '13800138000',
  countryRegion: '中国大陆',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  detailedAddress: '文三路88号2幢1单元502室',
  postalCode: '',
  userNote: '',
};

describe('offline address recognition', () => {
  it.each([
    '张三，13800138000，浙江省杭州市西湖区文三路88号2幢1单元502室',
    '张三 13800138000 浙江省 杭州市 西湖区 文三路88号2幢1单元502室',
    '张三\n13800138000\n浙江省杭州市西湖区文三路88号2幢1单元502室',
    '收件人：张三\n手机号码：13800138000\n所在地区：浙江省杭州市西湖区\n详细地址：文三路88号2幢1单元502室',
    '地址：浙江省杭州市西湖区文三路88号2幢1单元502室；电话：13800138000；姓名：张三',
    '浙江省杭州市西湖区文三路88号2幢1单元502室，张三，13800138000',
    '张三13800138000浙江省杭州市西湖区文三路88号2幢1单元502室',
    '张三，138-0013-8000，浙江杭州西湖区文三路88号2幢1单元502室',
    '张三，13800138000，浙江省杭州市西湖区，详细地址：文三路88号2幢1单元502室',
    '张三，１３８００１３８０００，中国大陆 浙江省杭州市西湖区文三路88号2幢1单元502室',
  ])('recognizes common copy formats: %s', (text) => {
    expect(parseAddress(text)).toEqual({
      payload: hangzhou,
      warnings: [],
      recognized: true,
      complete: true,
    });
  });

  it('normalizes country code and spaces without dropping door numbers', () => {
    const result = parseAddress('张三 +86 138 0013 8000 浙江省杭州市西湖区文三路88号 A-2幢 101室');
    expect(result.payload).toMatchObject({
      ...hangzhou,
      phone: '+8613800138000',
      detailedAddress: '文三路88号 A-2幢 101室',
    });
    expect(result.complete).toBe(true);
  });

  it.each([
    ['北京海淀区中关村大街1号', '北京市', '北京市', '海淀区', '中关村大街1号'],
    ['上海市上海市浦东新区测试路1号', '上海市', '上海市', '浦东新区', '测试路1号'],
    ['杭州市西湖区文三路1号', '浙江省', '杭州市', '西湖区', '文三路1号'],
    ['湖北省仙桃市测试路1号', '湖北省', '仙桃市', '', '测试路1号'],
    ['吉林市船营区测试路1号', '吉林省', '吉林市', '船营区', '测试路1号'],
    ['新疆乌鲁木齐市天山区测试路1号', '新疆维吾尔自治区', '乌鲁木齐市', '天山区', '测试路1号'],
  ])('resolves administrative hierarchy for %s', (address, province, city, district, detail) => {
    const result = parseAddress(`张三，13800138000，${address}`);
    expect(result.payload).toMatchObject({ province, city, district, detailedAddress: detail });
    expect(result.complete).toBe(true);
  });

  it('preserves explicitly labeled international names, postcode and delivery notes', () => {
    const result = parseAddress(
      '收件人：Alex Chen\n电话：13800138000\n地址：上海市浦东新区测试路1号\n邮编：200000\n备注：门口电话联系，不要放快递柜',
    );
    expect(result.payload).toMatchObject({
      recipientName: 'Alex Chen',
      postalCode: '200000',
      userNote: '门口电话联系，不要放快递柜',
    });
    expect(result.complete).toBe(true);
  });

  it('keeps a landline extension intact', () => {
    expect(parseAddress('张三，010-12345678-123，北京市海淀区测试路1号').payload.phone).toBe(
      '010-12345678-123',
    );
  });

  it.each(['138****8000', '138＊＊＊＊8000', '138xxxx8000'])(
    'does not invent masked digits: %s',
    (phone) => {
      const result = parseAddress(`收件人：张三\n电话：${phone}\n地址：上海市浦东新区测试路1号`);
      expect(result.payload.phone).toBe('');
      expect(result.complete).toBe(false);
      expect(result.warnings.join('')).toContain('隐藏字符');
    },
  );

  it('requires confirmation for multiple phones and does not choose one', () => {
    const result = parseAddress('张三，13800138000，13900139000，浙江省杭州市西湖区文三路88号');
    expect(result.payload.phone).toBe('');
    expect(result.warnings.join('')).toContain('多个电话号码');
  });

  it('does not strip a virtual-number extension', () => {
    const result = parseAddress('张三，13800138000转1234，上海市浦东新区测试路1号');
    expect(result.payload.phone).toBe('');
    expect(result.warnings.join('')).toContain('分机');
  });

  it('does not guess an ambiguous district', () => {
    const result = parseAddress('张三，13800138000，朝阳区测试路1号');
    expect(result.payload.province).toBe('');
    expect(result.payload.city).toBe('');
    expect(result.warnings.join('')).toContain('歧义');
  });

  it('does not discard conflicting province information', () => {
    const result = parseAddress('张三，13800138000，浙江省南京市鼓楼区测试路1号');
    expect(result.recognized).toBe(false);
    expect(result.warnings.join('')).toContain('上下级关系');
  });

  it('does not split a road name into a city', () => {
    expect(parseAddress('张三，13800138000，北京路1号').payload.province).toBe('');
  });

  it.each([
    '收件人：张三 电话：13800138000 地址：上海市浦东新区测试路1号\n收件人：李四 电话：13900139000 地址：北京市海淀区测试路2号',
    '张三，13800138000，上海市浦东新区测试路1号；北京市海淀区测试路2号',
  ])('does not combine multiple addresses', (text) => {
    expect(parseAddress(text).recognized).toBe(false);
    expect(parseAddress(text).complete).toBe(false);
  });

  it('keeps towns in detail for cities without county-level districts', () => {
    const result = parseAddress('张三，13800138000，广东省东莞市长安镇测试路1号');
    expect(result.payload.detailedAddress).toBe('长安镇测试路1号');
    expect(result.payload.district).toBe('');
    expect(result.complete).toBe(true);
  });

  it('does not mistake Latin names for masked phone numbers', () => {
    const result = parseAddress('Alex Chen，13800138000，上海市浦东新区测试路1号');
    expect(result.payload).toMatchObject({ recipientName: 'Alex Chen', phone: '13800138000' });
    expect(result.complete).toBe(true);
  });

  it('does not remove an eleven-digit building number as a phone', () => {
    const result = parseAddress('张三，上海市浦东新区测试路13800138000号');
    expect(result.payload.phone).toBe('');
    expect(result.payload.detailedAddress).toBe('测试路13800138000号');
    expect(result.complete).toBe(false);
  });

  it('preserves door numbers even when another phone is masked', () => {
    const result = parseAddress('张三，138****8000，上海市浦东新区测试路13800138000号');
    expect(result.payload.phone).toBe('');
    expect(result.payload.detailedAddress).toBe('测试路13800138000号');
    expect(result.complete).toBe(false);
  });

  it('does not rewrite unsupported regions to mainland China', () => {
    const result = parseAddress('收件人：张三 电话：13800138000 地址：香港九龙测试街1号');
    expect(result.payload.countryRegion).toBe('');
    expect(result.complete).toBe(false);
  });

  it('leaves unlabeled six-digit door information in detail', () => {
    expect(parseAddress('张三，13800138000，上海市浦东新区测试路123456号').payload).toMatchObject({
      postalCode: '',
      detailedAddress: '测试路123456号',
    });
  });

  it('never silently truncates an oversized field', () => {
    const result = parseAddress(`张三，13800138000，上海市浦东新区${'路'.repeat(501)}`);
    expect(result.payload.detailedAddress).toBe('');
    expect(result.warnings.join('')).toContain('不会自动截断');
  });

  it.each(['', ' ', 'a'.repeat(ADDRESS_TEXT_LIMIT + 1)])(
    'rejects empty and oversized input',
    (text) => {
      expect(parseAddress(text)).toMatchObject({ complete: false, recognized: false });
    },
  );

  it('detects existing user input, including notes and non-default countries', () => {
    expect(hasAddressContent({ ...EMPTY_ADDRESS })).toBe(false);
    expect(hasAddressContent({ ...EMPTY_ADDRESS, userNote: '原备注' })).toBe(true);
    expect(hasAddressContent({ ...EMPTY_ADDRESS, countryRegion: '其他' })).toBe(true);
  });
});
