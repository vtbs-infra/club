import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireSession } from '../auth/guards.js';
import type { SnapshotService } from './snapshot-service.js';

interface SnapshotRoutesOptions {
  readonly auth: AppAuth;
  readonly service: SnapshotService;
}

const Id = Type.String({ format: 'uuid' });
const EmptyBody = Type.Object({}, { additionalProperties: false });
const CreatorParameters = Type.Object({ creatorId: Id });
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
  const requireSession = createRequireSession(options.auth);

  app.get<{ Params: { creatorId: string } }>(
    '/api/v1/creators/:creatorId/snapshots',
    {
      preHandler: requireSession,
      schema: {
        params: CreatorParameters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['snapshots'],
      },
    },
    async (request) => {
      await options.service.assertAccess(session(request), { creatorId: request.params.creatorId });
      return options.service.listForCreator(request.params.creatorId);
    },
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/snapshots/:snapshotRunId',
    {
      preHandler: requireSession,
      schema: { params: RunParameters, response: { 200: Type.Any() }, tags: ['snapshots'] },
    },
    async (request) => {
      await options.service.assertAccess(session(request), { runId: request.params.snapshotRunId });
      return options.service.getDetail(request.params.snapshotRunId);
    },
  );

  app.get<{ Params: { snapshotRunId: string } }>(
    '/api/v1/snapshots/:snapshotRunId/integrity',
    {
      preHandler: requireSession,
      schema: {
        params: RunParameters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['snapshots'],
      },
    },
    async (request) => {
      await options.service.assertAccess(session(request), { runId: request.params.snapshotRunId });
      return options.service.checkEvidenceIntegrity(request.params.snapshotRunId);
    },
  );

  app.post<{ Body: Record<string, never>; Params: { snapshotRunId: string } }>(
    '/api/v1/snapshots/:snapshotRunId/retry',
    {
      preHandler: requireSession,
      schema: {
        body: EmptyBody,
        params: RunParameters,
        response: { 202: Type.Any() },
        tags: ['snapshots'],
      },
    },
    async (request, reply) => {
      await options.service.assertAccess(
        session(request),
        { runId: request.params.snapshotRunId },
        'operate',
      );
      await options.service.capture(request.params.snapshotRunId);
      return reply.status(202).send(await options.service.getDetail(request.params.snapshotRunId));
    },
  );

  app.post<{ Body: Record<string, never>; Params: { snapshotRunId: string } }>(
    '/api/v1/snapshots/:snapshotRunId/approve-late',
    {
      preHandler: requireSession,
      schema: {
        body: EmptyBody,
        params: RunParameters,
        response: { 204: Type.Null() },
        tags: ['snapshots'],
      },
    },
    async (request, reply) => {
      await options.service.assertAccess(
        session(request),
        { runId: request.params.snapshotRunId },
        'approve',
      );
      await options.service.approveLate(request.params.snapshotRunId, auditContext(request));
      return reply.status(204).send();
    },
  );

  app.post<{ Body: { reason: string }; Params: { snapshotRunId: string } }>(
    '/api/v1/snapshots/:snapshotRunId/reject-late',
    {
      preHandler: requireSession,
      schema: {
        body: Type.Object({ reason: Type.String({ maxLength: 500, minLength: 3 }) }),
        params: RunParameters,
        response: { 204: Type.Null() },
        tags: ['snapshots'],
      },
    },
    async (request, reply) => {
      await options.service.assertAccess(
        session(request),
        { runId: request.params.snapshotRunId },
        'approve',
      );
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
