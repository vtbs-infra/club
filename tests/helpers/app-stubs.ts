import type { AppDatabase, DatabaseService } from '../../src/server/infrastructure/db/database.js';
import type { BindingRuntime } from '../../src/server/modules/binding/binding-runtime.js';
import type { FulfillmentRuntime } from '../../src/server/modules/fulfillment/fulfillment-runtime.js';
import type { GiftMediaRuntime } from '../../src/server/modules/gifts/gift-media-runtime.js';
import type { SnapshotRuntime } from '../../src/server/modules/snapshots/snapshot-runtime.js';

export function fakeDatabase(
  ping: () => Promise<void> = () => Promise.resolve(),
  checkSchema: () => Promise<void> = ping,
): DatabaseService {
  return {
    checkSchema,
    close: () => Promise.resolve(),
    orm: {} as AppDatabase,
    ping,
  };
}

export function runtimeStatus(state: 'DEGRADED' | 'RUNNING' | 'STOPPED') {
  const now = new Date('2026-07-30T08:00:00.000Z');
  return {
    lastErrorAt: state === 'DEGRADED' ? now : null,
    lastErrorCode: state === 'DEGRADED' ? 'START_FAILED' : null,
    lastSuccessAt: state === 'RUNNING' ? now : null,
    lastTickAt: state === 'RUNNING' ? now : null,
    nextRetryAt: state === 'DEGRADED' ? new Date(now.getTime() + 30_000) : null,
    startedAt: state === 'STOPPED' ? null : now,
    state,
  };
}

export function bindingRuntimeStub(
  overrides: Partial<Pick<BindingRuntime, 'close' | 'getStatus' | 'start'>> = {},
): BindingRuntime {
  return {
    bindings: {},
    close: () => Promise.resolve(),
    connections: {},
    getStatus: () => runtimeStatus('STOPPED'),
    rooms: {},
    source: {},
    start: () => Promise.resolve(),
    ...overrides,
  } as unknown as BindingRuntime;
}

export function fulfillmentRuntimeStub(
  overrides: Partial<Pick<FulfillmentRuntime, 'close' | 'getStatus' | 'start'>> = {},
): FulfillmentRuntime {
  return {
    close: () => undefined,
    getStatus: () => ({ ...runtimeStatus('STOPPED'), configured: false }),
    provider: null,
    service: {},
    start: () => Promise.resolve(),
    tick: () => Promise.resolve(),
    ...overrides,
  } as unknown as FulfillmentRuntime;
}

export function giftMediaRuntimeStub(
  overrides: Partial<Pick<GiftMediaRuntime, 'close' | 'getStatus' | 'start'>> = {},
): GiftMediaRuntime {
  return {
    close: () => Promise.resolve(),
    getStatus: () => runtimeStatus('STOPPED'),
    service: {},
    start: () => Promise.resolve(),
    tick: () => Promise.resolve(),
    ...overrides,
  } as unknown as GiftMediaRuntime;
}

export function snapshotRuntimeStub(
  overrides: Partial<Pick<SnapshotRuntime, 'close' | 'getStatus' | 'start'>> = {},
): SnapshotRuntime {
  return {
    close: () => undefined,
    getStatus: () => runtimeStatus('STOPPED'),
    service: {},
    source: {},
    start: () => Promise.resolve(),
    tick: () => Promise.resolve(),
    ...overrides,
  } as unknown as SnapshotRuntime;
}
