import { Type } from '@sinclair/typebox';
import type { FastifyPluginCallback } from 'fastify';

import {
  LivenessResponseSchema,
  ReadinessResponseSchema,
  type ReadinessResponse,
} from '../../../shared/contracts/health.js';
import { SystemStatusSchema } from '../../../shared/contracts/system.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { AppAuth } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import type { BindingRuntime } from '../binding/binding-runtime.js';
import type { FulfillmentRuntime } from '../fulfillment/fulfillment-runtime.js';
import type { GiftMediaRuntime } from '../gifts/gift-media-runtime.js';
import type { SnapshotRuntime } from '../snapshots/snapshot-runtime.js';
import { SystemStatusService } from './system-status-service.js';

interface SystemStatusOptions {
  readonly auth: AppAuth;
  readonly backgroundRequired: boolean;
  readonly bindingRuntime: BindingRuntime;
  readonly clock: Clock;
  readonly database: DatabaseService;
  readonly fulfillmentRuntime: FulfillmentRuntime;
  readonly giftMediaRuntime: GiftMediaRuntime;
  readonly snapshotRuntime: SnapshotRuntime;
  readonly storage: StorageDriver;
  readonly version: string;
}

const systemStatusRoutes: FastifyPluginCallback<SystemStatusOptions> = (app, options, done) => {
  const service = new SystemStatusService(options);
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);
  app.get(
    '/health/live',
    {
      schema: {
        description: 'Process liveness check.',
        response: { 200: LivenessResponseSchema },
        tags: ['system'],
      },
    },
    () => ({
      now: options.clock.now().toISOString(),
      status: 'ok' as const,
      version: options.version,
    }),
  );
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
      const runtimeStatuses = [
        options.bindingRuntime.getStatus(),
        options.snapshotRuntime.getStatus(),
        options.fulfillmentRuntime.getStatus(),
        options.giftMediaRuntime.getStatus(),
      ];
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
  app.get(
    '/api/v1/system/version',
    {
      schema: { response: { 200: Type.Object({ version: Type.String() }) }, tags: ['system'] },
    },
    () => ({ version: options.version }),
  );
  app.get(
    '/api/v1/admin/system',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 200: SystemStatusSchema }, tags: ['system'] },
    },
    () => service.platform(),
  );
  done();
};

export default systemStatusRoutes;
