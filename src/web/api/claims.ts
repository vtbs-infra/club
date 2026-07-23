import type { AddressPayload } from './addresses';
import { apiRequest } from './http';

export type ClaimStatus = 'SUBMITTED' | 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';

export interface ClaimSummary {
  readonly biliUid: string;
  readonly campaignId: string;
  readonly cancelledAt: string | null;
  readonly claimNumber: string;
  readonly completedAt: string | null;
  readonly id: string;
  readonly processingAt: string | null;
  readonly shippedAt: string | null;
  readonly status: ClaimStatus;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ClaimDetail extends ClaimSummary {
  readonly address: AddressPayload | null;
  readonly history: readonly {
    readonly createdAt: string;
    readonly fromStatus: ClaimStatus | null;
    readonly reason: string | null;
    readonly toStatus: ClaimStatus;
  }[];
  readonly optionValues: Readonly<Record<string, string>>;
  readonly packages: readonly {
    readonly entitlementId: string;
    readonly giftPackage: {
      readonly description: string;
      readonly id: string;
      readonly name: string;
    };
  }[];
}

export const getClaims = () => apiRequest<ClaimSummary[]>('/api/v1/me/claims');
export const getClaim = (claimId: string) =>
  apiRequest<ClaimDetail>(`/api/v1/me/claims/${claimId}`);

export const submitClaim = (
  campaignId: string,
  input: {
    readonly addressId: string;
    readonly optionValues: Readonly<Record<string, string>>;
    readonly version?: number;
  },
  idempotencyKey: string,
) =>
  apiRequest<ClaimSummary>(`/api/v1/me/campaigns/${campaignId}/claim`, {
    body: JSON.stringify(input),
    headers: { 'idempotency-key': idempotencyKey },
    method: 'POST',
  });

export const cancelClaim = (claimId: string, version: number, reason: string) =>
  apiRequest<ClaimSummary>(`/api/v1/me/claims/${claimId}/cancel`, {
    body: JSON.stringify({ reason, version }),
    method: 'POST',
  });

export const confirmClaimReceipt = (claimId: string, version: number) =>
  apiRequest<ClaimSummary>(`/api/v1/me/claims/${claimId}/confirm-receipt`, {
    body: JSON.stringify({ version }),
    method: 'POST',
  });

export const updateClaimAddress = (claimId: string, addressId: string, version: number) =>
  apiRequest<ClaimSummary>(`/api/v1/me/claims/${claimId}/address`, {
    body: JSON.stringify({ addressId, version }),
    method: 'PATCH',
  });

export const updateClaimOptions = (
  claimId: string,
  optionValues: Readonly<Record<string, string>>,
  version: number,
) =>
  apiRequest<ClaimSummary>(`/api/v1/me/claims/${claimId}/options`, {
    body: JSON.stringify({ optionValues, version }),
    method: 'PATCH',
  });
