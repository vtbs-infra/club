import type { AppDatabase, DatabaseService } from '../../src/server/infrastructure/db/database.js';
import type { PeriodicRuntime } from '../../src/server/infrastructure/runtime/periodic-runtime.js';

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

export function runtimeStub(
  overrides: Partial<Pick<PeriodicRuntime, 'close' | 'getStatus' | 'start'>> = {},
): PeriodicRuntime {
  return {
    close: () => Promise.resolve(),
    getStatus: () => runtimeStatus('STOPPED'),
    start: () => Promise.resolve(),
    requestTick: () => undefined,
    tick: () => Promise.resolve(),
    ...overrides,
  };
}
