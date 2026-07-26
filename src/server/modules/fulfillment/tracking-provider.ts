export const SHIPMENT_STATUSES = [
  'LABEL_CREATED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface TrackingEventResult {
  readonly description: string;
  readonly id: string;
  readonly location?: string | undefined;
  readonly occurredAt: Date;
  readonly status: ShipmentStatus;
}

export interface TrackingResult {
  readonly events: readonly TrackingEventResult[];
  readonly nextRefreshAt: Date | null;
  readonly publicUrl?: string | undefined;
  readonly status: ShipmentStatus;
}

export interface TrackingProvider {
  buildPublicUrl?(carrierCode: string, trackingNumber: string): string;
  query(carrierCode: string, trackingNumber: string): Promise<TrackingResult>;
}
