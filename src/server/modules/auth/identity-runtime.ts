import type { Clock } from '../../infrastructure/clock/clock.js';
import {
  createPeriodicRuntime,
  type PeriodicRuntime,
} from '../../infrastructure/runtime/periodic-runtime.js';
import type { RoomConnectionManager } from '../bilibili/room-connection-manager.js';
import type { IdentityService } from './identity-service.js';

export type IdentityRuntime = PeriodicRuntime;

export function createIdentityRuntime(input: {
  readonly clock: Clock;
  readonly identities: Pick<IdentityService, 'reconcileConnections'>;
  readonly connections: Pick<RoomConnectionManager, 'close'>;
  readonly reportError?: (error: unknown, operation: string) => void;
}): IdentityRuntime {
  const runtime = createPeriodicRuntime({
    clock: input.clock,
    name: 'identity',
    intervalMs: 30_000,
    run: () => input.identities.reconcileConnections(),
    ...(input.reportError ? { reportError: input.reportError } : {}),
  });
  return {
    ...runtime,
    async close() {
      await Promise.all([input.connections.close(), runtime.close()]);
    },
  };
}
