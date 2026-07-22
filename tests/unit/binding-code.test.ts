import { describe, expect, it } from 'vitest';

import {
  digestBindingCode,
  generateBindingCode,
  normalizeBindingCode,
} from '../../src/server/modules/binding/binding-service.js';

describe('Bilibili binding codes', () => {
  it('generates cryptographically random, unambiguous ASCII codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateBindingCode()));

    expect(codes.size).toBe(100);
    for (const code of codes) expect(code).toMatch(/^CLUB-[A-HJ-NP-Z2-9]{6}$/);
  });

  it('normalizes only the intended ASCII code shape', () => {
    expect(normalizeBindingCode('  club-7k4m2p ')).toBe('CLUB-7K4M2P');
    expect(normalizeBindingCode('ＣＬＵＢ-7K4M2P')).toBeNull();
    expect(normalizeBindingCode('CLUB-7K4M2O')).toBeNull();
    expect(normalizeBindingCode('please use CLUB-7K4M2P')).toBeNull();
  });

  it('stores a keyed digest rather than the reusable challenge code', () => {
    const code = 'CLUB-7K4M2P';
    const first = digestBindingCode(code, 'secret-a');
    const second = digestBindingCode(code, 'secret-b');

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(code);
    expect(first).not.toBe(second);
  });
});
