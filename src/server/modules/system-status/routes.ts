import { Type } from '@sinclair/typebox';
import type { FastifyPluginCallback } from 'fastify';

import {
  LivenessResponseSchema,
  ReadinessResponseSchema,
  type ReadinessResponse,
} from '../../../shared/contracts/health.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { AppAuth } from '../auth/auth.js';
import { createRequireOrganizationPermission, createRequirePlatformAdmin } from '../auth/guards.js';
import type { FulfillmentRuntime } from '../fulfillment/fulfillment-runtime.js';
import type { SnapshotRuntime } from '../snapshots/snapshot-runtime.js';
import { SystemStatusService } from './system-status-service.js';

interface SystemStatusOptions {
  readonly auth: AppAuth;
  readonly clock: Clock;
  readonly database: DatabaseService;
  readonly fulfillmentRuntime: FulfillmentRuntime;
  readonly snapshotRuntime: SnapshotRuntime;
  readonly storage: StorageDriver;
  readonly version: string;
}

const systemStatusRoutes: FastifyPluginCallback<SystemStatusOptions> = (app, options, done) => {
  const service = new SystemStatusService(options);
  const requireOrganizationReader = createRequireOrganizationPermission(
    options.auth,
    options.database,
    'organization.read',
  );
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);
  app.get(
    '/health/live',
    {
      schema: {
        description: 'Process liveness check that does not access external dependencies.',
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
        description: 'Readiness check for PostgreSQL and private storage.',
        response: {
          200: ReadinessResponseSchema,
          503: ReadinessResponseSchema,
        },
        tags: ['system'],
      },
    },
    async (_request, reply) => {
      const [database, storage] = await Promise.allSettled([
        options.database.ping(),
        options.storage.checkHealth(),
      ]);
      const response: ReadinessResponse = {
        checks: {
          database: database.status === 'fulfilled' ? 'ok' : 'down',
          storage: storage.status === 'fulfilled' ? 'ok' : 'down',
        },
        status:
          database.status === 'fulfilled' && storage.status === 'fulfilled' ? 'ok' : 'not_ready',
      };
      return reply.status(response.status === 'ok' ? 200 : 503).send(response);
    },
  );

  app.get(
    '/api/v1/system/version',
    {
      schema: {
        description: 'Public application version metadata.',
        response: {
          200: Type.Object({ version: Type.String() }),
        },
        tags: ['system'],
      },
    },
    () => ({ version: options.version }),
  );

  app.get(
    '/api/v1/platform/system-status',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 200: Type.Any() }, tags: ['system'] },
    },
    () => service.platform(),
  );

  app.get<{ Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId/system-status',
    {
      preHandler: requireOrganizationReader,
      schema: {
        params: Type.Object({ orgId: Type.String({ format: 'uuid' }) }),
        response: { 200: Type.Any() },
        tags: ['system'],
      },
    },
    (request) =>
      service.organization(request.params.orgId, request.organizationAccess?.creatorIds ?? []),
  );

  done();
};

export default systemStatusRoutes;
