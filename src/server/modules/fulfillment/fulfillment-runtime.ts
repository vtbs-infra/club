import type { AppConfig } from '../../config/env.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { EncryptionKeyRing } from '../../infrastructure/encryption/key-ring.js';
import type { AddressService } from '../addresses/address-service.js';
import { GiftOrderService } from '../gifts/order-service.js';
import { FakeTrackingProvider } from './fake-tracking-provider.js';
import type { TrackingProvider } from './tracking-provider.js';

export interface FulfillmentRuntime {
  readonly provider: TrackingProvider | null;
  readonly service: GiftOrderService;
  close(): void;
  getStatus(): {
    readonly configured: boolean;
    readonly lastTickAt: Date | null;
    readonly running: boolean;
  };
  start(): Promise<void>;
  tick(): Promise<void>;
}

export function createFulfillmentRuntime(input: {
  readonly addresses: AddressService;
  readonly clock: Clock;
  readonly config: AppConfig;
  readonly database: DatabaseService;
  readonly encryption: EncryptionKeyRing;
  readonly provider?: TrackingProvider | null;
}): FulfillmentRuntime {
  const provider =
    input.provider === undefined
      ? input.config.trackingProvider === 'fake'
        ? new FakeTrackingProvider(input.clock)
        : null
      : input.provider;
  const service = new GiftOrderService(input.database, input.encryption, input.addresses, provider);
  let interval: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let lastTickAt: Date | null = null;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await service.expireClaimable();
      await service.refreshDue();
    } finally {
      lastTickAt = input.clock.now();
      ticking = false;
    }
  };
  return {
    provider,
    service,
    close() {
      if (interval) clearInterval(interval);
      interval = null;
    },
    getStatus: () => ({
      configured: provider !== null,
      lastTickAt,
      running: interval !== null,
    }),
    async start() {
      if (interval) return;
      await tick();
      interval = setInterval(() => void tick().catch(() => undefined), 60_000);
      interval.unref();
    },
    tick,
  };
}
