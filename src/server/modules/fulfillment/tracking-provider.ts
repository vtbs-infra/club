export const SHIPMENT_PROGRESS_STATES = [
  'LABEL_CREATED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

export const TRACKING_STATUSES = [...SHIPMENT_PROGRESS_STATES, 'EXCEPTION'] as const;

export type ShipmentProgress = (typeof SHIPMENT_PROGRESS_STATES)[number];
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export interface TrackingEventResult {
  readonly description: string;
  readonly id: string;
  readonly location?: string | undefined;
  readonly occurredAt: Date;
  readonly status: TrackingStatus;
}

export interface TrackingResult {
  readonly events: readonly TrackingEventResult[];
  readonly nextRefreshAt: Date | null;
  readonly publicUrl?: string | undefined;
  readonly status: TrackingStatus;
}

export interface TrackingProvider {
  buildPublicUrl?(carrierCode: string, trackingNumber: string): string;
  query(carrierCode: string, trackingNumber: string): Promise<TrackingResult>;
}
