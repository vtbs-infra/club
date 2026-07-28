import type { AddressPayload } from './addresses';
import type { ClaimStatus } from './claims';
import { apiRequest } from './http';

export type ShipmentStatus =
  'LABEL_CREATED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'EXCEPTION';

export interface ShipmentDetail {
  readonly carrierCode: string;
  readonly claimEntitlementIds: readonly string[];
  readonly claimId: string;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly events: readonly {
    readonly description: string;
    readonly id: string;
    readonly location: string | null;
    readonly occurredAt: string;
    readonly status: ShipmentStatus;
  }[];
  readonly exceptionMessage: string | null;
  readonly id: string;
  readonly lastTrackingRefreshAt: string | null;
  readonly nextTrackingRefreshAt: string | null;
  readonly shipmentKey: string;
  readonly shipmentNumber: string;
  readonly status: ShipmentStatus;
  readonly trackingNumber: string;
  readonly trackingUrl: string | null;
  readonly updatedAt: string;
}

export interface FulfillmentClaim {
  readonly biliUid: string;
  readonly campaignId: string;
  readonly campaignTitle: string;
  readonly claimNumber: string;
  readonly creatorId: string;
  readonly id: string;
  readonly periodStart: string;
  readonly shipments: readonly ShipmentDetail[];
  readonly status: ClaimStatus;
  readonly updatedAt: string;
  readonly version: number;
}

export interface FulfillmentClaimDetail {
  readonly address: AddressPayload;
  readonly claim: {
    readonly claimNumber: string;
    readonly id: string;
    readonly status: ClaimStatus;
    readonly version: number;
  };
  readonly shipments: readonly ShipmentDetail[];
}

function queryString(filters: {
  readonly campaignId?: string;
  readonly creatorId?: string;
  readonly periodStart?: string;
  readonly status?: string;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export const getFulfillmentClaims = (
  organizationId: string,
  filters: { readonly campaignId?: string; readonly creatorId?: string; readonly status?: string },
) =>
  apiRequest<FulfillmentClaim[]>(
    `/api/v1/organizations/${organizationId}/fulfillment/claims${queryString(filters)}`,
  );

export const getFulfillmentClaim = (claimId: string) =>
  apiRequest<FulfillmentClaimDetail>(`/api/v1/claims/${claimId}/fulfillment`);

export const getClaimShipments = (claimId: string) =>
  apiRequest<ShipmentDetail[]>(`/api/v1/me/claims/${claimId}/shipments`);

export const processClaims = (
  organizationId: string,
  claimIds: readonly string[],
  idempotencyKey: string,
) =>
  apiRequest<{ readonly processedClaimIds: readonly string[] }>(
    `/api/v1/organizations/${organizationId}/claims/batch-processing`,
    {
      body: JSON.stringify({ claimIds }),
      headers: { 'idempotency-key': idempotencyKey },
      method: 'POST',
    },
  );

export const createShipment = (
  claimId: string,
  input: {
    readonly carrierCode: string;
    readonly claimEntitlementIds?: readonly string[];
    readonly shipmentKey: string;
    readonly trackingNumber: string;
    readonly trackingUrl?: string;
  },
) =>
  apiRequest<{ readonly replayed: boolean; readonly shipment: ShipmentDetail }>(
    `/api/v1/claims/${claimId}/shipments`,
    { body: JSON.stringify(input), method: 'POST' },
  );

export const refreshShipment = (shipmentId: string) =>
  apiRequest<ShipmentDetail>(`/api/v1/shipments/${shipmentId}/refresh`, {
    method: 'POST',
  });

export const importShipments = (organizationId: string, csv: string) =>
  apiRequest<{
    readonly formatVersion: string;
    readonly results: readonly {
      readonly code?: string;
      readonly message?: string;
      readonly rowNumber: number;
      readonly shipmentId?: string;
      readonly status: 'ERROR' | 'IMPORTED' | 'UNCHANGED';
    }[];
  }>(`/api/v1/organizations/${organizationId}/shipments/import`, {
    body: JSON.stringify({ csv }),
    method: 'POST',
  });

export async function downloadFulfillmentCsv(organizationId: string) {
  const response = await fetch(`/api/v1/organizations/${organizationId}/fulfillment/export.csv`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Fulfillment CSV could not be exported.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'club-fulfillment-v1.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function downloadName(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}

export async function downloadCurrentMonthGuardWorkbook(organizationId: string, creatorId: string) {
  const response = await fetch(
    `/api/v1/organizations/${organizationId}/creators/${creatorId}/guards/current-month.xlsx`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    throw new Error('Current-month guard address workbook could not be exported.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadName(response, 'current-month-guard-addresses.xlsx');
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadShipmentTemplate() {
  const response = await fetch('/api/v1/shipments/export-template', {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Shipment template could not be downloaded.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'club-shipment-import-v1.csv';
  link.click();
  URL.revokeObjectURL(url);
}
