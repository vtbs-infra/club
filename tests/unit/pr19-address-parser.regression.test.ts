import { describe, expect, it } from 'vitest';

import { parseAddress } from '../../src/web/lib/address-parser';

describe('PR #19 address parser safety regressions', () => {
  it('rejects repeated full-address labels even when the second address omits its city', () => {
    const result = parseAddress(
      '收件人：张三\n电话：13800138000\n收货地址：上海市浦东新区测试路1号\n收货地址：浦东新区测试路2号',
    );
    expect(result.complete).toBe(false);
    expect(result.recognized).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('keeps a trailing delivery instruction and requests the missing recipient', () => {
    const result = parseAddress('13800138000，上海市浦东新区测试路1号，工作日送货');
    expect(result.payload.recipientName).toBe('');
    expect(result.payload.detailedAddress).toBe('测试路1号，工作日送货');
    expect(result.complete).toBe(false);
    expect(result.warnings.join('')).toContain('收件人');
  });

  it('does not remove matching door digits when the phone comes from its own field', () => {
    const result = parseAddress(
      '收件人：张三\n电话：13800138000\n地址：上海市浦东新区测试路13800138000号',
    );
    expect(result.payload.phone).toBe('13800138000');
    expect(result.payload.detailedAddress).toBe('测试路13800138000号');
    expect(result.complete).toBe(true);
  });

  it('removes the actual trailing phone match instead of an earlier identical door number', () => {
    const result = parseAddress('张三，上海市浦东新区测试路13800138000号，13800138000');
    expect(result.payload.phone).toBe('13800138000');
    expect(result.payload.detailedAddress).toBe('测试路13800138000号');
    expect(result.complete).toBe(true);
  });
});
