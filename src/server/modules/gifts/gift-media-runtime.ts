import type { Clock } from '../../infrastructure/clock/clock.js';
import {
  createPeriodicRuntime,
  type PeriodicRuntime,
} from '../../infrastructure/runtime/periodic-runtime.js';
import { type GiftMediaService, GIFT_COVER_STAGED_SAFETY_MS } from './gift-media-service.js';

export type GiftMediaRuntime = PeriodicRuntime;

export function createGiftMediaRuntime(input: {
  readonly clock: Clock;
  readonly service: Pick<GiftMediaService, 'cleanupObjects'>;
  readonly reportError?: (error: unknown, operation: string) => void;
}): GiftMediaRuntime {
  return createPeriodicRuntime({
    clock: input.clock,
    name: 'gift-media',
    intervalMs: 5 * 60_000,
    run: async () => {
      await input.service.cleanupObjects(
        new Date(input.clock.now().getTime() - GIFT_COVER_STAGED_SAFETY_MS),
      );
    },
    ...(input.reportError ? { reportError: input.reportError } : {}),
  });
}
