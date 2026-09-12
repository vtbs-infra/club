import type { FastifyPluginCallback } from 'fastify';
import {
  ReadinessResponseSchema,
  type ReadinessResponse,
} from '../../../shared/contracts/health.js';
import type { DatabaseService } from '../db/database.js';
import type { StorageDriver } from '../storage/storage-driver.js';
import type { PeriodicRuntime } from '../runtime/periodic-runtime.js';

export interface ReadinessOptions {
  readonly database: Pick<DatabaseService, 'ping' | 'checkSchema'>;
  readonly storage: Pick<StorageDriver, 'checkHealth'>;
  readonly runtimes: readonly Pick<PeriodicRuntime, 'getStatus'>[];
  readonly backgroundRequired: boolean;
}

const readinessRoutes: FastifyPluginCallback<ReadinessOptions> = (app, options, done) => {
  app.get(
    '/health/ready',
    {
      schema: {
        description: 'Readiness check for PostgreSQL, schema, storage, and background runtimes.',
        response: { 200: ReadinessResponseSchema, 503: ReadinessResponseSchema },
        tags: ['system'],
      },
    },
    async (_request, reply) => {
      const [database, schema, storage] = await Promise.allSettled([
        options.database.ping(),
        options.database.checkSchema(),
        options.storage.checkHealth(),
      ]);
      const runtimeStatuses = options.runtimes.map((runtime) => runtime.getStatus());
      const runtimes =
        options.backgroundRequired &&
        runtimeStatuses.every((runtime) => runtime.state === 'RUNNING')
          ? 'ok'
          : options.backgroundRequired
            ? 'down'
            : 'disabled';
      const response: ReadinessResponse = {
        checks: {
          database: database.status === 'fulfilled' ? 'ok' : 'down',
          runtimes,
          schema: schema.status === 'fulfilled' ? 'ok' : 'down',
          storage: storage.status === 'fulfilled' ? 'ok' : 'down',
        },
        status:
          database.status === 'fulfilled' &&
          schema.status === 'fulfilled' &&
          storage.status === 'fulfilled' &&
          runtimes !== 'down'
            ? 'ok'
            : 'not_ready',
      };
      return reply.status(response.status === 'ok' ? 200 : 503).send(response);
    },
  );
  done();
};

export default readinessRoutes;
