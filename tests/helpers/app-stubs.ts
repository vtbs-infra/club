import type { AppDatabase, DatabaseService } from '../../src/server/infrastructure/db/database.js';
import type { IdentityRuntime } from '../../src/server/modules/auth/identity-runtime.js';
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

export function identityRuntimeStub(
  overrides: Partial<Pick<IdentityRuntime, 'close' | 'getStatus' | 'start'>> = {},
): IdentityRuntime {
  return {
    close: () => Promise.resolve(),
    getStatus: () => runtimeStatus('STOPPED'),
    start: () => Promise.resolve(),
    requestTick: () => undefined,
    tick: () => Promise.resolve(),
    ...overrides,
  };
}

export function giftMediaRuntimeStub(
  overrides: Partial<Pick<GiftMediaRuntime, 'close' | 'getStatus' | 'start'>> = {},
): GiftMediaRuntime {
  return {
    close: () => Promise.resolve(),
    getStatus: () => runtimeStatus('STOPPED'),
    start: () => Promise.resolve(),
    requestTick: () => undefined,
    tick: () => Promise.resolve(),
    ...overrides,
  };
}

export function snapshotRuntimeStub(
  overrides: Partial<Pick<SnapshotRuntime, 'close' | 'getStatus' | 'start'>> = {},
): SnapshotRuntime {
  return {
    close: () => Promise.resolve(),
    getStatus: () => runtimeStatus('STOPPED'),
    start: () => Promise.resolve(),
    requestTick: () => undefined,
    tick: () => Promise.resolve(),
    ...overrides,
  };
}
