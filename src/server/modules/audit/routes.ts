import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { AuditLogPageSchema } from '../../../shared/contracts/audit.js';
import type { AppAuth } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import type { AuditQueryService } from './audit-query-service.js';

interface AuditRoutesOptions {
  readonly auth: AppAuth;
  readonly service: AuditQueryService;
}

const Query = Type.Object(
  {
    cursor: Type.Optional(Type.String({ maxLength: 512, minLength: 1 })),
    limit: Type.Optional(Type.Integer({ default: 50, maximum: 100, minimum: 1 })),
  },
  { additionalProperties: false },
);

const auditRoutes: FastifyPluginAsync<AuditRoutesOptions> = (app, options) => {
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/v1/admin/audit-logs',
    {
      preHandler: requirePlatformAdmin,
      schema: { querystring: Query, response: { 200: AuditLogPageSchema }, tags: ['audit'] },
    },
    (request) =>
      options.service.listPlatform({
        ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        limit: request.query.limit ?? 50,
      }),
  );
  return Promise.resolve();
};

export default auditRoutes;
