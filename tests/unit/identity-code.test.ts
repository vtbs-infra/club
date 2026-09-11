import { describe, expect, it } from 'vitest';

import {
  digestIdentityCode,
  generateIdentityCode,
  normalizeIdentityCode,
} from '../../src/server/modules/auth/identity-service.js';

describe('Bilibili identity codes', () => {
  it('generates cryptographically random, unambiguous ASCII codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateIdentityCode()));

    expect(codes.size).toBe(100);
    for (const code of codes) expect(code).toMatch(/^CLUB-[A-HJ-NP-Z2-9]{10}$/);
  });

  it('normalizes only the intended ASCII code shape', () => {
    expect(normalizeIdentityCode('  club-7k4m2pabcd ')).toBe('CLUB-7K4M2PABCD');
    expect(normalizeIdentityCode('ＣＬＵＢ-7K4M2PABCD')).toBeNull();
    expect(normalizeIdentityCode('CLUB-7K4M2O')).toBeNull();
    expect(normalizeIdentityCode('please use CLUB-7K4M2PABCD')).toBeNull();
  });

  it('stores a keyed digest rather than the reusable challenge code', () => {
    const code = 'CLUB-7K4M2PABCD';
    const first = digestIdentityCode(code, 'secret-a');
    const second = digestIdentityCode(code, 'secret-b');

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(code);
    expect(first).not.toBe(second);
  });
});
