import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth } from '../auth/auth.js';
import { createRequireOrganizationPermission, createRequirePlatformAdmin } from '../auth/guards.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AuditQueryService } from './audit-query-service.js';

interface AuditRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: AuditQueryService;
}

const Query = Type.Object(
  {
    before: Type.Optional(Type.String({ format: 'date-time' })),
    limit: Type.Optional(Type.Integer({ default: 50, maximum: 100, minimum: 1 })),
  },
  { additionalProperties: false },
);
const OrganizationParameters = Type.Object({ orgId: Type.String({ format: 'uuid' }) });

const auditRoutes: FastifyPluginAsync<AuditRoutesOptions> = (app, options) => {
  const requireAuditReader = createRequireOrganizationPermission(
    options.auth,
    options.database,
    'audit.read',
  );
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);

  app.get<{
    Params: { orgId: string };
    Querystring: { before?: string; limit?: number };
  }>(
    '/api/v1/organizations/:orgId/audit-logs',
    {
      preHandler: requireAuditReader,
      schema: {
        params: OrganizationParameters,
        querystring: Query,
        response: { 200: Type.Any() },
        tags: ['audit'],
      },
    },
    (request) =>
      options.service.listOrganization(
        request.params.orgId,
        request.organizationAccess?.creatorIds ?? [],
        {
          ...(request.query.before ? { before: new Date(request.query.before) } : {}),
          limit: request.query.limit ?? 50,
        },
      ),
  );

  app.get<{ Querystring: { before?: string; limit?: number } }>(
    '/api/v1/platform/audit-logs',
    {
      preHandler: requirePlatformAdmin,
      schema: { querystring: Query, response: { 200: Type.Any() }, tags: ['audit'] },
    },
    (request) =>
      options.service.listPlatform({
        ...(request.query.before ? { before: new Date(request.query.before) } : {}),
        limit: request.query.limit ?? 50,
      }),
  );

  return Promise.resolve();
};

export default auditRoutes;
