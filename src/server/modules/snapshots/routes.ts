import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { EmptyBodySchema, IdSchema } from '../../../shared/contracts/common.js';
import {
  AdminSnapshotSchema,
  CreatorSnapshotDetailSchema,
  SnapshotDetailSchema,
  SnapshotIntegrityResultSchema,
  SnapshotRunSchema,
} from '../../../shared/contracts/snapshots.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireCreator, createRequirePlatformAdmin } from '../auth/guards.js';
import type { SnapshotService } from './snapshot-service.js';

interface SnapshotRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: SnapshotService;
}

const RunParameters = Type.Object({ snapshotRunId: IdSchema });

function session(request: { readonly authSession: AuthSession | null }): AuthSession {
  if (!request.authSession) throw new Error('Authenticated route is missing its session.');
  return request.authSession;
}

function auditContext(request: {
  readonly authSession: AuthSession | null;
  readonly id: string;
  readonly ip: string;
}) {
  return {
    actorUserId: session(request).user.id,
    ipAddress: request.ip,
    requestId: request.id,
  };
}

const snapshotRoutes: FastifyPluginAsync<SnapshotRoutesOptions> = (app, options) => {
  const requireCreator = createRequireCreator(options.auth, options.database);
  const requireAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/creator/rosters',
    {
      preHandler: requireCreator,
      schema: {
        response: { 200: Type.Array(SnapshotRunSchema) },
        tags: ['creator-rosters'],
      },
    },
    (request) => options.service.queries.listForCreator(request.creatorProfile!.id),
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/creator/rosters/:snapshotRunId',
    {
      preHandler: requireCreator,
      schema: {
        params: RunParameters,
        response: { 200: CreatorSnapshotDetailSchema },
        tags: ['creator-rosters'],
      },
    },
    async (request) => {
      await options.service.queries.assertAccess(session(request), {
        runId: request.params.snapshotRunId,
      });
      const detail = await options.service.queries.getDetail(request.params.snapshotRunId);
      return {
        attempts: detail.attempts.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          captureCompletedAt: attempt.captureCompletedAt,
          captureStartedAt: attempt.captureStartedAt,
          consistencyStatus: attempt.consistencyStatus,
          declaredTotal: attempt.declaredTotal,
          failureCode: attempt.failureCode,
          failureMessage: attempt.failureMessage,
          normalizedTotal: attempt.normalizedTotal,
          punctuality: attempt.punctuality,
        })),
        run: detail.run,
      };
    },
  );

  app.get<{ Querystring: { creatorId?: string } }>(
    '/api/v1/admin/rosters',
    {
      preHandler: requireAdmin,
      schema: {
        querystring: Type.Object({ creatorId: Type.Optional(IdSchema) }),
        response: { 200: Type.Array(AdminSnapshotSchema) },
        tags: ['admin-rosters'],
      },
    },
    (request) => options.service.queries.listAll(request.query.creatorId),
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId',
    {
      preHandler: requireAdmin,
      schema: {
        params: RunParameters,
        response: { 200: SnapshotDetailSchema },
        tags: ['admin-rosters'],
      },
    },
    (request) => options.service.queries.getDetail(request.params.snapshotRunId),
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId/integrity',
    {
      preHandler: requireAdmin,
      schema: {
        params: RunParameters,
        response: { 200: Type.Array(SnapshotIntegrityResultSchema) },
        tags: ['admin-rosters'],
      },
    },
    (request) => options.service.queries.checkEvidenceIntegrity(request.params.snapshotRunId),
  );

  app.post<{ Body: Record<string, never>; Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId/retry',
    {
      preHandler: requireAdmin,
      schema: {
        body: EmptyBodySchema,
        params: RunParameters,
        response: { 202: Type.Object({ attemptId: IdSchema }) },
        tags: ['admin-rosters'],
      },
    },
    async (request, reply) => {
      const queued = await options.service.queueCapture(request.params.snapshotRunId);
      return reply.status(202).send(queued);
    },
  );

  app.post<{ Body: Record<string, never>; Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId/approve-late',
    {
      preHandler: requireAdmin,
      schema: {
        body: EmptyBodySchema,
        params: RunParameters,
        response: { 204: Type.Null() },
        tags: ['admin-rosters'],
      },
    },
    async (request, reply) => {
      await options.service.approveLate(request.params.snapshotRunId, auditContext(request));
      return reply.status(204).send();
    },
  );

  app.post<{ Body: { reason: string }; Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId/reject-late',
    {
      preHandler: requireAdmin,
      schema: {
        body: Type.Object(
          { reason: Type.String({ maxLength: 500, minLength: 3 }) },
          { additionalProperties: false },
        ),
        params: RunParameters,
        response: { 204: Type.Null() },
        tags: ['admin-rosters'],
      },
    },
    async (request, reply) => {
      await options.service.rejectLate(request.params.snapshotRunId, {
        ...auditContext(request),
        reason: request.body.reason,
      });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

export default snapshotRoutes;
