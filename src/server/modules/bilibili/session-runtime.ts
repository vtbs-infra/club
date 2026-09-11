import type { Clock } from '../../infrastructure/clock/clock.js';
import {
  createPeriodicRuntime,
  type PeriodicRuntime,
} from '../../infrastructure/runtime/periodic-runtime.js';
import type { BilibiliSessionService } from './session-service.js';

export function createBilibiliSessionRuntime(input: {
  readonly clock: Clock;
  readonly service: BilibiliSessionService;
  readonly reportError?: (error: unknown, operation: string) => void;
}): PeriodicRuntime {
  const runtime = createPeriodicRuntime({
    clock: input.clock,
    name: 'bilibili-session',
    intervalMs: 2000,
    initialize: () => input.service.initialize(),
    run: () => input.service.tick(),
    ...(input.reportError ? { reportError: input.reportError } : {}),
  });
  return {
    ...runtime,
    async close() {
      input.service.beginShutdown();
      await runtime.close();
      await input.service.close();
    },
  };
}
