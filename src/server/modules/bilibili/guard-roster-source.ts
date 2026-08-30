export type GuardTier = 'CAPTAIN' | 'ADMIRAL' | 'GOVERNOR';

export const GUARD_ROSTER_PAGE_BYTE_LIMIT = 2 * 1024 * 1024;

export interface GuardRosterMember {
  readonly biliUid: string;
  readonly displayName: string;
  readonly rawTier: string;
  readonly sourcePosition: number;
  readonly tier: GuardTier | null;
}

export interface GuardRosterPage {
  readonly declaredPageCount: number;
  readonly declaredTotal: number;
  readonly fetchedAt: Date;
  readonly members: readonly GuardRosterMember[];
  readonly pageNumber: number;
  readonly rawBytes: Uint8Array;
}

export interface FetchGuardRosterPageInput {
  readonly creatorUid: string;
  readonly pageNumber: number;
  readonly pageSize: number;
  readonly roomId: string;
  readonly signal: AbortSignal;
}

export interface GuardRosterSource {
  readonly name: string;
  readonly version: string;
  fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage>;
}

export function normalizeGuardTier(rawTier: unknown): GuardTier | null {
  if (rawTier === 1 || rawTier === '1') return 'GOVERNOR';
  if (rawTier === 2 || rawTier === '2') return 'ADMIRAL';
  if (rawTier === 3 || rawTier === '3') return 'CAPTAIN';
  return null;
}
