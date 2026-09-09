import type { Clock } from '../../infrastructure/clock/clock.js';
import {
  createPeriodicRuntime,
  type PeriodicRuntime,
} from '../../infrastructure/runtime/periodic-runtime.js';
import type { RoomConnectionManager } from '../bilibili/room-connection-manager.js';
import type { BindingService } from './binding-service.js';

export type BindingRuntime = PeriodicRuntime;

export function createBindingRuntime(input: {
  readonly clock: Clock;
  readonly bindings: Pick<BindingService, 'reconcileConnections'>;
  readonly connections: Pick<RoomConnectionManager, 'close'>;
  readonly reportError?: (error: unknown, operation: string) => void;
}): BindingRuntime {
  const runtime = createPeriodicRuntime({
    clock: input.clock,
    name: 'binding',
    intervalMs: 30_000,
    run: () => input.bindings.reconcileConnections(),
    ...(input.reportError ? { reportError: input.reportError } : {}),
  });
  return {
    ...runtime,
    async close() {
      await Promise.all([input.connections.close(), runtime.close()]);
    },
  };
}
