import type { CampaignClaimField } from '../../infrastructure/db/schema.js';

export const GUARD_TIERS = ['CAPTAIN', 'ADMIRAL', 'GOVERNOR'] as const;
export type GuardTier = (typeof GUARD_TIERS)[number];
export type FulfillmentMode = 'HIGHEST_ONLY' | 'CUMULATIVE';

const tierRank: Readonly<Record<GuardTier, number>> = {
  CAPTAIN: 1,
  ADMIRAL: 2,
  GOVERNOR: 3,
};

export interface TierPackageRule {
  readonly giftPackageId: string;
  readonly tier: GuardTier;
}

export function selectEarnedPackageIds(
  capturedTier: GuardTier,
  mode: FulfillmentMode,
  rules: readonly TierPackageRule[],
): readonly string[] {
  const eligible = rules
    .filter((rule) => tierRank[rule.tier] <= tierRank[capturedTier])
    .sort((left, right) => tierRank[left.tier] - tierRank[right.tier]);
  if (mode === 'CUMULATIVE') return eligible.map((rule) => rule.giftPackageId);
  const highest = eligible.at(-1);
  return highest ? [highest.giftPackageId] : [];
}

export function validateClaimFieldSchema(value: unknown): value is readonly CampaignClaimField[] {
  if (!Array.isArray(value) || value.length > 20) return false;
  const keys = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return false;
    const field = candidate as Record<string, unknown>;
    if (
      typeof field.key !== 'string' ||
      !/^[a-z][a-z0-9_]{0,39}$/.test(field.key) ||
      keys.has(field.key) ||
      typeof field.label !== 'string' ||
      field.label.trim().length < 1 ||
      field.label.length > 80 ||
      typeof field.required !== 'boolean' ||
      !['TEXT', 'LONG_TEXT', 'SELECT'].includes(String(field.type))
    ) {
      return false;
    }
    keys.add(field.key);
    if (field.type === 'SELECT') {
      if (
        !Array.isArray(field.options) ||
        field.options.length < 1 ||
        field.options.length > 30 ||
        field.options.some(
          (option) => typeof option !== 'string' || option.trim().length < 1 || option.length > 80,
        ) ||
        new Set(field.options).size !== field.options.length
      ) {
        return false;
      }
    } else if (field.options !== undefined) {
      return false;
    }
  }
  return true;
}
