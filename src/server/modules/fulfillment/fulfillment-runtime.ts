import type { AppConfig } from '../../config/env.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { EncryptionKeyRing } from '../../infrastructure/encryption/key-ring.js';
import { FakeTrackingProvider } from './fake-tracking-provider.js';
import { FulfillmentService } from './fulfillment-service.js';
import type { TrackingProvider } from './tracking-provider.js';

export interface FulfillmentRuntime {
  readonly provider: TrackingProvider | null;
  readonly service: FulfillmentService;
  close(): void;
  start(): Promise<void>;
  tick(): Promise<void>;
}

export function createFulfillmentRuntime(input: {
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
  const service = new FulfillmentService(input.database, input.encryption, provider);
  let interval: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  const tick = async () => {
    if (ticking || !provider) return;
    ticking = true;
    try {
      await service.refreshDue();
    } finally {
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
    async start() {
      if (!provider || interval) return;
      await tick();
      interval = setInterval(() => void tick().catch(() => undefined), 60_000);
      interval.unref();
    },
    tick,
  };
}
