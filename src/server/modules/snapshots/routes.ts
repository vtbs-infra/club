import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireCreator, createRequirePlatformAdmin } from '../auth/guards.js';
import type { SnapshotService } from './snapshot-service.js';

interface SnapshotRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: SnapshotService;
}

const Id = Type.String({ format: 'uuid' });
const EmptyBody = Type.Object({}, { additionalProperties: false });
const RunParameters = Type.Object({ snapshotRunId: Id });

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
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['creator-rosters'] },
    },
    (request) => options.service.listForCreator(request.creatorProfile!.id),
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/creator/rosters/:snapshotRunId',
    {
      preHandler: requireCreator,
      schema: {
        params: RunParameters,
        response: { 200: Type.Any() },
        tags: ['creator-rosters'],
      },
    },
    async (request) => {
      await options.service.assertAccess(session(request), {
        runId: request.params.snapshotRunId,
      });
      const detail = await options.service.getDetail(request.params.snapshotRunId);
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
        querystring: Type.Object({ creatorId: Type.Optional(Id) }),
        response: { 200: Type.Array(Type.Any()) },
        tags: ['admin-rosters'],
      },
    },
    (request) => options.service.listAll(request.query.creatorId),
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId',
    {
      preHandler: requireAdmin,
      schema: {
        params: RunParameters,
        response: { 200: Type.Any() },
        tags: ['admin-rosters'],
      },
    },
    (request) => options.service.getDetail(request.params.snapshotRunId),
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId/integrity',
    {
      preHandler: requireAdmin,
      schema: {
        params: RunParameters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['admin-rosters'],
      },
    },
    (request) => options.service.checkEvidenceIntegrity(request.params.snapshotRunId),
  );

  app.post<{ Body: Record<string, never>; Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId/retry',
    {
      preHandler: requireAdmin,
      schema: {
        body: EmptyBody,
        params: RunParameters,
        response: { 202: Type.Any() },
        tags: ['admin-rosters'],
      },
    },
    async (request, reply) => {
      await options.service.capture(request.params.snapshotRunId);
      return reply.status(202).send(await options.service.getDetail(request.params.snapshotRunId));
    },
  );

  app.post<{ Body: Record<string, never>; Params: { snapshotRunId: string } }>(
    '/api/v1/admin/rosters/:snapshotRunId/approve-late',
    {
      preHandler: requireAdmin,
      schema: {
        body: EmptyBody,
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
