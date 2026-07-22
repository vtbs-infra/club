import { describe, expect, it } from 'vitest';

import {
  selectEarnedPackageIds,
  validateClaimFieldSchema,
  type GuardTier,
} from '../../src/server/modules/campaigns/campaign-domain.js';

const completeRules = [
  { giftPackageId: 'captain', tier: 'CAPTAIN' },
  { giftPackageId: 'admiral', tier: 'ADMIRAL' },
  { giftPackageId: 'governor', tier: 'GOVERNOR' },
] as const;

describe('gift tier eligibility', () => {
  it.each([
    ['CAPTAIN', 'HIGHEST_ONLY', ['captain']],
    ['ADMIRAL', 'HIGHEST_ONLY', ['admiral']],
    ['GOVERNOR', 'HIGHEST_ONLY', ['governor']],
    ['CAPTAIN', 'CUMULATIVE', ['captain']],
    ['ADMIRAL', 'CUMULATIVE', ['captain', 'admiral']],
    ['GOVERNOR', 'CUMULATIVE', ['captain', 'admiral', 'governor']],
  ] as const)('%s with %s selects deterministic packages', (tier, mode, expected) => {
    expect(selectEarnedPackageIds(tier, mode, completeRules)).toEqual(expected);
  });

  it.each([
    ['CAPTAIN', []],
    ['ADMIRAL', []],
    ['GOVERNOR', ['governor']],
  ] as readonly [GuardTier, readonly string[]][])(
    'handles sparse rules for %s',
    (tier, expected) => {
      expect(
        selectEarnedPackageIds(tier, 'HIGHEST_ONLY', [
          { giftPackageId: 'governor', tier: 'GOVERNOR' },
        ]),
      ).toEqual(expected);
    },
  );
});

describe('claim-field schema validation', () => {
  it('accepts text, long text, and select fields', () => {
    expect(
      validateClaimFieldSchema([
        { key: 'size', label: 'Size', options: ['S', 'M', 'L'], required: true, type: 'SELECT' },
        { key: 'note', label: 'Note', required: false, type: 'LONG_TEXT' },
        { key: 'style', label: 'Style', required: true, type: 'TEXT' },
      ]),
    ).toBe(true);
  });

  it.each([
    null,
    [{ key: 'Size', label: 'Size', required: true, type: 'TEXT' }],
    [
      { key: 'size', label: 'Size', required: true, type: 'TEXT' },
      { key: 'size', label: 'Again', required: false, type: 'TEXT' },
    ],
    [{ key: 'size', label: 'Size', required: true, type: 'SELECT' }],
    [{ key: 'size', label: 'Size', options: ['M'], required: true, type: 'TEXT' }],
    [{ key: 'size', label: 'Size', options: ['M', 'M'], required: true, type: 'SELECT' }],
  ])('rejects malformed schema %#', (schema) => {
    expect(validateClaimFieldSchema(schema)).toBe(false);
  });
});
