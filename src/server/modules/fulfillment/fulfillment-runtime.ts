import type { AppConfig } from '../../config/env.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { EncryptionKeyRing } from '../../infrastructure/encryption/key-ring.js';
import {
  RuntimeStatusTracker,
  type RuntimeStatus,
} from '../../infrastructure/runtime/runtime-status.js';
import type { AddressService } from '../addresses/address-service.js';
import { GiftOrderService } from '../gifts/order-service.js';
import { FakeTrackingProvider } from './fake-tracking-provider.js';
import { TrackingRefreshService } from './tracking-refresh-service.js';
import type { TrackingProvider } from './tracking-provider.js';

export interface FulfillmentRuntime {
  readonly provider: TrackingProvider | null;
  readonly service: GiftOrderService;
  readonly tracking: TrackingRefreshService;
  close(): Promise<void>;
  getStatus(): {
    readonly configured: boolean;
  } & RuntimeStatus;
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
  readonly reportError?: (error: unknown, operation: string) => void;
  readonly retryDelayMs?: number;
}): FulfillmentRuntime {
  const provider =
    input.provider === undefined
      ? input.config.trackingProvider === 'fake'
        ? new FakeTrackingProvider(input.clock)
        : null
      : input.provider;
  const service = new GiftOrderService(input.database, input.encryption, input.addresses, provider);
  const tracking = new TrackingRefreshService(input.database, provider);
  let interval: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let starting: Promise<void> | null = null;
  let activeTick: Promise<void> | null = null;
  let closed = false;
  const retryDelayMs = input.retryDelayMs ?? 30_000;
  const status = new RuntimeStatusTracker(input.clock);
  const tick = (): Promise<void> => {
    if (activeTick) return activeTick;
    activeTick = (async () => {
      try {
        await service.expireClaimable();
        await tracking.refreshDue();
        status.markSuccess();
      } catch (error) {
        status.markFailure(error, new Date(input.clock.now().getTime() + 60_000));
        input.reportError?.(error, 'fulfillment.tick');
        throw error;
      } finally {
        activeTick = null;
      }
    })();
    return activeTick;
  };
  const scheduleStartRetry = (): void => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void start().catch((error) => input.reportError?.(error, 'fulfillment.retry'));
    }, retryDelayMs);
    retryTimer.unref();
  };
  const start = async (): Promise<void> => {
    if (closed || interval) return;
    if (starting) return starting;
    status.markStarting();
    starting = (async () => {
      try {
        await tick();
        if (closed) return;
        interval = setInterval(
          () => void tick().catch((error) => input.reportError?.(error, 'fulfillment.timer')),
          60_000,
        );
        interval.unref();
      } catch (error) {
        status.markFailure(error, new Date(input.clock.now().getTime() + retryDelayMs));
        input.reportError?.(error, 'fulfillment.start');
        scheduleStartRetry();
        throw error;
      } finally {
        starting = null;
      }
    })();
    return starting;
  };
  return {
    provider,
    service,
    tracking,
    async close() {
      closed = true;
      if (interval) clearInterval(interval);
      interval = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      await Promise.allSettled([starting, activeTick].filter((task) => task !== null));
      status.markStopped();
    },
    getStatus: () => ({
      configured: provider !== null,
      ...status.get(),
    }),
    start,
    tick,
  };
}
