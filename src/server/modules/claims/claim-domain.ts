import { createHash } from 'node:crypto';

import { AppError } from '../../../shared/errors/app-error.js';
import type { CampaignClaimField } from '../../infrastructure/db/schema.js';

export const CLAIM_STATUSES = [
  'SUBMITTED',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type GiftDisplayState =
  'WAITING_TO_CLAIM' | 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';

export function canTransitionClaim(
  from: ClaimStatus,
  to: ClaimStatus,
  actor: 'OPERATOR' | 'USER',
): boolean {
  if (actor === 'USER') {
    return (
      (from === 'SUBMITTED' && to === 'CANCELLED') ||
      (from === 'CANCELLED' && to === 'SUBMITTED') ||
      (from === 'SHIPPED' && to === 'COMPLETED')
    );
  }
  return (
    (from === 'SUBMITTED' && (to === 'PROCESSING' || to === 'CANCELLED')) ||
    (from === 'PROCESSING' && (to === 'SHIPPED' || to === 'CANCELLED')) ||
    (from === 'SHIPPED' && to === 'COMPLETED')
  );
}

export function projectGiftState(input: {
  readonly claimStatus: ClaimStatus | null;
  readonly deadlineAt: Date;
  readonly hasRevokedEntitlement: boolean;
  readonly now: Date;
}): GiftDisplayState {
  if (input.hasRevokedEntitlement) return 'REVOKED';
  if (input.claimStatus === 'SUBMITTED' || input.claimStatus === 'PROCESSING') return 'PROCESSING';
  if (input.claimStatus === 'SHIPPED') return 'SHIPPED';
  if (input.claimStatus === 'COMPLETED') return 'COMPLETED';
  if (input.claimStatus === 'CANCELLED') return 'CANCELLED';
  if (input.now > input.deadlineAt) return 'EXPIRED';
  return 'WAITING_TO_CLAIM';
}

export function normalizeClaimOptions(
  schema: readonly CampaignClaimField[],
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const known = new Map(schema.map((field) => [field.key, field]));
  if (Object.keys(values).some((key) => !known.has(key))) {
    throw new AppError('CLAIM_OPTIONS_INVALID', 'Claim options contain an unknown field.', 400);
  }
  const normalized: Record<string, string> = {};
  for (const field of schema) {
    const value = values[field.key]?.trim() ?? '';
    if (field.required && !value) {
      throw new AppError('CLAIM_OPTIONS_INVALID', `Claim field ${field.key} is required.`, 400);
    }
    if (!value) continue;
    const maximum = field.type === 'LONG_TEXT' ? 2_000 : 200;
    if (value.length > maximum || (field.type === 'SELECT' && !field.options?.includes(value))) {
      throw new AppError('CLAIM_OPTIONS_INVALID', `Claim field ${field.key} is invalid.`, 400);
    }
    normalized[field.key] = value;
  }
  return normalized;
}

export function idempotencyRequestHash(input: {
  readonly addressId?: string;
  readonly claimIds?: readonly string[];
  readonly optionValues?: Readonly<Record<string, string>>;
  readonly version?: number | undefined;
}): string {
  const canonical = {
    ...(input.addressId === undefined ? {} : { addressId: input.addressId }),
    ...(input.claimIds === undefined ? {} : { claimIds: [...input.claimIds].sort() }),
    ...(input.optionValues === undefined
      ? {}
      : {
          optionValues: Object.fromEntries(
            Object.entries(input.optionValues).sort(([left], [right]) => left.localeCompare(right)),
          ),
        }),
    ...(input.version === undefined ? {} : { version: input.version }),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
