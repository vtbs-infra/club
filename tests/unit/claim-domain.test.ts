import { describe, expect, it } from 'vitest';

import {
  canTransitionClaim,
  idempotencyRequestHash,
  normalizeClaimOptions,
  projectGiftState,
  type ClaimStatus,
} from '../../src/server/modules/claims/claim-domain.js';

describe('claim state machine', () => {
  const statuses = ['SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED'] as const;
  const userAllowed = new Set(['SUBMITTED:CANCELLED', 'CANCELLED:SUBMITTED', 'SHIPPED:COMPLETED']);
  const operatorAllowed = new Set([
    'SUBMITTED:PROCESSING',
    'SUBMITTED:CANCELLED',
    'PROCESSING:SHIPPED',
    'PROCESSING:CANCELLED',
    'SHIPPED:COMPLETED',
  ]);

  it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))(
    'exhaustively evaluates %s -> %s',
    (from, to) => {
      expect(canTransitionClaim(from, to, 'USER')).toBe(userAllowed.has(`${from}:${to}`));
      expect(canTransitionClaim(from, to, 'OPERATOR')).toBe(operatorAllowed.has(`${from}:${to}`));
    },
  );
});

describe('gift display projections', () => {
  it.each([
    [null, false, '2026-03-01', 'WAITING_TO_CLAIM'],
    [null, false, '2026-01-01', 'EXPIRED'],
    ['SUBMITTED', false, '2026-01-01', 'PROCESSING'],
    ['PROCESSING', false, '2026-01-01', 'PROCESSING'],
    ['SHIPPED', false, '2026-01-01', 'SHIPPED'],
    ['COMPLETED', false, '2026-01-01', 'COMPLETED'],
    ['CANCELLED', false, '2026-01-01', 'CANCELLED'],
    ['COMPLETED', true, '2026-03-01', 'REVOKED'],
  ] as readonly [ClaimStatus | null, boolean, string, string][])(
    'projects %s revoked=%s deadline=%s as %s',
    (claimStatus, hasRevokedEntitlement, deadline, expected) => {
      expect(
        projectGiftState({
          claimStatus,
          deadlineAt: new Date(`${deadline}T00:00:00.000Z`),
          hasRevokedEntitlement,
          now: new Date('2026-02-01T00:00:00.000Z'),
        }),
      ).toBe(expected);
    },
  );
});

describe('claim input normalization', () => {
  const schema = [
    { key: 'size', label: 'Size', options: ['S', 'M'], required: true, type: 'SELECT' },
    { key: 'note', label: 'Note', required: false, type: 'LONG_TEXT' },
  ] as const;

  it('normalizes valid fields and ignores blank optional values', () => {
    expect(normalizeClaimOptions(schema, { note: ' ', size: ' M ' })).toEqual({ size: 'M' });
  });

  it('rejects missing, unknown, and invalid select values', () => {
    expect(() => normalizeClaimOptions(schema, {})).toThrow(/required/);
    expect(() => normalizeClaimOptions(schema, { other: 'x', size: 'M' })).toThrow(/unknown/);
    expect(() => normalizeClaimOptions(schema, { size: 'XL' })).toThrow(/invalid/);
  });

  it('hashes semantically identical idempotent input deterministically', () => {
    expect(
      idempotencyRequestHash({ addressId: 'one', optionValues: { note: 'x', size: 'M' } }),
    ).toBe(idempotencyRequestHash({ addressId: 'one', optionValues: { size: 'M', note: 'x' } }));
  });
});
