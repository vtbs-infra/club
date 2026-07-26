import type { Clock } from '../../infrastructure/clock/clock.js';
import type { ShipmentStatus, TrackingProvider, TrackingResult } from './tracking-provider.js';

function statusFor(trackingNumber: string): ShipmentStatus {
  const digit = Number(trackingNumber.at(-1) ?? '0');
  if (!Number.isFinite(digit)) return 'IN_TRANSIT';
  if (digit === 9) return 'EXCEPTION';
  if (digit >= 7) return 'DELIVERED';
  if (digit >= 4) return 'OUT_FOR_DELIVERY';
  return 'IN_TRANSIT';
}

export class FakeTrackingProvider implements TrackingProvider {
  public constructor(private readonly clock: Clock) {}

  public buildPublicUrl(carrierCode: string, trackingNumber: string) {
    return `https://tracking.example.test/${encodeURIComponent(carrierCode)}/${encodeURIComponent(trackingNumber)}`;
  }

  public query(carrierCode: string, trackingNumber: string): Promise<TrackingResult> {
    const now = this.clock.now();
    const status = statusFor(trackingNumber);
    return Promise.resolve({
      events: [
        {
          description:
            status === 'EXCEPTION'
              ? 'Deterministic test exception'
              : `Deterministic ${status.toLowerCase().replaceAll('_', ' ')}`,
          id: `fake:${carrierCode}:${trackingNumber}:${status}`,
          location: 'Test distribution center',
          occurredAt: now,
          status,
        },
      ],
      nextRefreshAt: status === 'DELIVERED' ? null : new Date(now.getTime() + 30 * 60_000),
      publicUrl: this.buildPublicUrl(carrierCode, trackingNumber),
      status,
    });
  }
}
