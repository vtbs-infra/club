import type { GuardTier } from '../../shared/contracts/common';
import type {
  CreatorOrder,
  CreatorOrderOverview,
  FulfillmentReleaseSummaryPage,
  GiftFormField,
  GiftOrder,
  GiftOrderListFilter,
  GiftOrderStatus,
  GiftOrderSummary,
  GiftOrderSummaryPage,
  GiftRelease,
  GiftReleaseSummary,
  GiftReleaseSummaryPage,
  ReleaseInput,
  ReleasePackageInput,
  ReleasePublishInput,
  ReleaseUpdateInput,
} from '../../shared/contracts/gifts';
import { apiDownload, apiRequest } from './http';

export type {
  CreatorOrder,
  CreatorOrderOverview,
  FulfillmentReleaseSummaryPage,
  GiftFormField,
  GiftOrder,
  GiftOrderListFilter,
  GiftOrderStatus,
  GiftOrderSummary,
  GiftOrderSummaryPage,
  GiftRelease,
  GiftReleaseSummary,
  GiftReleaseSummaryPage,
  GuardTier,
  ReleaseInput,
  ReleasePackageInput,
  ReleasePublishInput,
  ReleaseUpdateInput,
};

function queryString(values: Readonly<Record<string, number | string | undefined>>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return query ? `?${query}` : '';
}

export function getMyGifts(
  input: {
    readonly cursor?: string | undefined;
    readonly filter?: GiftOrderListFilter | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<GiftOrderSummaryPage> {
  return apiRequest(`/api/v1/me/gifts${queryString(input)}`);
}

export function getMyGift(giftOrderId: string): Promise<GiftOrder> {
  return apiRequest(`/api/v1/me/gifts/${giftOrderId}`);
}

export function submitGift(
  giftOrderId: string,
  input: {
    readonly addressId: string;
    readonly expectedVersion: number;
    readonly options: Readonly<Record<string, boolean | string>>;
  },
): Promise<GiftOrder> {
  return apiRequest(`/api/v1/me/gifts/${giftOrderId}/submit`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function getCreatorReleases(
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<GiftReleaseSummaryPage> {
  return apiRequest(`/api/v1/creator/releases${queryString(input)}`);
}

export function getCreatorRelease(releaseId: string): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}`);
}

export function createCreatorRelease(input: ReleaseInput): Promise<GiftRelease> {
  return apiRequest('/api/v1/creator/releases', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateCreatorRelease(
  releaseId: string,
  input: ReleaseUpdateInput,
): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}`, {
    body: JSON.stringify(input),
    method: 'PUT',
  });
}

export function publishCreatorRelease(
  releaseId: string,
  input: ReleasePublishInput,
): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}/publish`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function closeCreatorRelease(releaseId: string): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}/close`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function deleteCreatorRelease(releaseId: string): Promise<void> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}`, { method: 'DELETE' });
}

export function uploadCreatorReleaseCover(
  releaseId: string,
  file: File,
): Promise<{ readonly coverImageUrl: string }> {
  const body = new FormData();
  body.append('file', file);
  return apiRequest(`/api/v1/creator/releases/${releaseId}/cover`, {
    body,
    method: 'POST',
  });
}

export function getCreatorOrders(
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
    readonly search?: string | undefined;
    readonly status?: GiftOrderStatus | undefined;
  } = {},
): Promise<GiftOrderSummaryPage> {
  return apiRequest(`/api/v1/creator/orders${queryString(input)}`);
}

export function getCreatorOrderOverview(): Promise<CreatorOrderOverview> {
  return apiRequest('/api/v1/creator/orders/overview');
}

export function getFulfillmentReleases(
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<FulfillmentReleaseSummaryPage> {
  return apiRequest(`/api/v1/creator/orders/fulfillment-releases${queryString(input)}`);
}

export function getCreatorOrder(giftOrderId: string): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}`);
}

export function downloadFulfillmentWorkbook(releaseId: string) {
  return apiDownload('/api/v1/creator/orders/fulfillment-export', {
    body: JSON.stringify({ releaseId }),
    method: 'POST',
  });
}

export function shipCreatorOrder(
  giftOrderId: string,
  input: {
    readonly carrierCode: string;
    readonly carrierName: string;
    readonly trackingNumber: string;
    readonly trackingUrl?: null | string;
  },
): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}/ship`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function completeCreatorOrder(giftOrderId: string): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}/complete`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function cancelCreatorOrder(giftOrderId: string, reason: string): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}/cancel`, {
    body: JSON.stringify({ reason }),
    method: 'POST',
  });
}
