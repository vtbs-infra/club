import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { EmptyBodySchema, IdSchema } from '../../../shared/contracts/common.js';
import {
  AdminSnapshotPageSchema,
  CreatorSnapshotDetailSchema,
  SnapshotAttemptMemberPageSchema,
  SnapshotDetailSchema,
  SnapshotIntegrityResultPageSchema,
  SnapshotMemberPageSchema,
  SnapshotPagePageSchema,
  SnapshotRunPageSchema,
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
const AttemptParameters = Type.Object({ snapshotAttemptId: IdSchema, snapshotRunId: IdSchema });

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

  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/v1/creator/rosters',
    {
      preHandler: requireCreator,
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: SnapshotRunPageSchema },
        tags: ['creator-rosters'],
      },
    },
    (request) =>
      options.service.queries.listForCreator(request.creatorProfile!.id, {
        cursor: request.query.cursor,
        limit: request.query.limit ?? 24,
      }),
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

  app.get<{ Querystring: { creatorId?: string; cursor?: string; limit?: number } }>(
    '/api/v1/admin/rosters',
    {
      preHandler: requireAdmin,
      schema: {
        querystring: Type.Object({
          creatorId: Type.Optional(IdSchema),
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: AdminSnapshotPageSchema },
        tags: ['admin-rosters'],
      },
    },
    (request) =>
      options.service.queries.listAll({
        creatorId: request.query.creatorId,
        cursor: request.query.cursor,
        limit: request.query.limit ?? 30,
      }),
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

  app.get<{
    Params: { snapshotRunId: string };
    Querystring: { cursor?: string; limit?: number; search?: string };
  }>(
    '/api/v1/admin/rosters/:snapshotRunId/members',
    {
      preHandler: requireAdmin,
      schema: {
        params: RunParameters,
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
          search: Type.Optional(Type.String({ maxLength: 80 })),
        }),
        response: { 200: SnapshotMemberPageSchema },
        tags: ['admin-rosters'],
      },
    },
    (request) =>
      options.service.queries.listMembers(request.params.snapshotRunId, {
        cursor: request.query.cursor,
        limit: request.query.limit ?? 50,
        search: request.query.search,
      }),
  );

  app.get<{
    Params: { snapshotAttemptId: string; snapshotRunId: string };
    Querystring: { cursor?: string; limit?: number; search?: string };
  }>(
    '/api/v1/admin/rosters/:snapshotRunId/attempts/:snapshotAttemptId/members',
    {
      preHandler: requireAdmin,
      schema: {
        params: AttemptParameters,
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
          search: Type.Optional(Type.String({ maxLength: 80 })),
        }),
        response: { 200: SnapshotAttemptMemberPageSchema },
        tags: ['admin-rosters'],
      },
    },
    (request) =>
      options.service.queries.listAttemptMembers(
        request.params.snapshotRunId,
        request.params.snapshotAttemptId,
        {
          cursor: request.query.cursor,
          limit: request.query.limit ?? 50,
          search: request.query.search,
        },
      ),
  );

  app.get<{
    Params: { snapshotAttemptId: string; snapshotRunId: string };
    Querystring: { cursor?: string; limit?: number };
  }>(
    '/api/v1/admin/rosters/:snapshotRunId/attempts/:snapshotAttemptId/pages',
    {
      preHandler: requireAdmin,
      schema: {
        params: AttemptParameters,
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: SnapshotPagePageSchema },
        tags: ['admin-rosters'],
      },
    },
    (request) =>
      options.service.queries.listPages(
        request.params.snapshotRunId,
        request.params.snapshotAttemptId,
        { cursor: request.query.cursor, limit: request.query.limit ?? 50 },
      ),
  );

  app.get<{
    Params: { snapshotAttemptId: string; snapshotRunId: string };
    Querystring: { cursor?: string; limit?: number };
  }>(
    '/api/v1/admin/rosters/:snapshotRunId/attempts/:snapshotAttemptId/integrity',
    {
      preHandler: requireAdmin,
      schema: {
        params: AttemptParameters,
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: SnapshotIntegrityResultPageSchema },
        tags: ['admin-rosters'],
      },
    },
    (request) =>
      options.service.queries.checkEvidenceIntegrity(
        request.params.snapshotRunId,
        request.params.snapshotAttemptId,
        { cursor: request.query.cursor, limit: request.query.limit ?? 50 },
      ),
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
      const queued = await options.service.queueCapture(
        request.params.snapshotRunId,
        auditContext(request),
      );
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
