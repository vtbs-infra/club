import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';

import {
  BilibiliBindingSchema,
  BilibiliChallengeSchema,
  BindingConflictPageSchema,
  BindingConflictResolutionInputSchema,
  IssuedBilibiliChallengeSchema,
} from '../../../shared/contracts/binding.js';
import { IdSchema, Nullable } from '../../../shared/contracts/common.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { InMemoryRateLimiter } from '../../infrastructure/security/request-security.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import {
  createRequirePlatformAdmin,
  createRequireSession,
  resolveSession,
} from '../auth/guards.js';
import type { BindingService } from './binding-service.js';
import type { BindingConflictService } from './binding-conflict-service.js';

interface BindingRoutesOptions {
  readonly auth: AppAuth;
  readonly challengeLimiter: InMemoryRateLimiter;
  readonly clock: Clock;
  readonly conflicts: BindingConflictService;
  readonly service: BindingService;
}

interface ConflictParameters {
  conflictId: string;
}

interface ConflictResolutionBody {
  reason: string;
}

function auditContext(request: {
  readonly authSession: AuthSession | null;
  readonly id: string;
  readonly ip: string;
}) {
  if (!request.authSession) throw new Error('Authenticated route is missing its session.');
  return {
    actorUserId: request.authSession.user.id,
    ipAddress: request.ip,
    requestId: request.id,
  };
}

function createChallengeThrottle(options: BindingRoutesOptions): preHandlerHookHandler {
  return async (request, reply) => {
    const session = await resolveSession(request, options.auth);
    const keys = [`binding-ip:${request.ip}`, `binding-user:${session.user.id}`];
    const results = keys.map((key) => options.challengeLimiter.consume(key, options.clock.now()));
    if (results.some((result) => !result.allowed)) {
      const retryAfter = Math.max(...results.map((result) => result.retryAfterSeconds));
      void reply.header('retry-after', String(retryAfter));
      throw new AppError('BINDING_CHALLENGE_RATE_LIMITED', 'Try again later.', 429);
    }
  };
}

const bindingRoutes: FastifyPluginAsync<BindingRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/me/bilibili-binding',
    {
      preHandler: requireSession,
      schema: { response: { 200: Nullable(BilibiliBindingSchema) }, tags: ['bilibili-binding'] },
    },
    async (request) =>
      (await options.service.getAccountState(request.authSession!.user.id)).binding,
  );

  app.get(
    '/api/v1/me/bilibili-challenges/current',
    {
      preHandler: requireSession,
      schema: {
        response: { 200: Nullable(BilibiliChallengeSchema) },
        tags: ['bilibili-binding'],
      },
    },
    async (request) =>
      (await options.service.getAccountState(request.authSession!.user.id)).challenge,
  );

  app.post<{ Body: Record<string, never> }>(
    '/api/v1/me/bilibili-challenges',
    {
      preHandler: [requireSession, createChallengeThrottle(options)],
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        response: {
          201: IssuedBilibiliChallengeSchema,
        },
        tags: ['bilibili-binding'],
      },
    },
    async (request, reply) => {
      const challenge = await options.service.createChallenge({
        ...auditContext(request),
        userId: request.authSession!.user.id,
      });
      return reply.status(201).send(challenge);
    },
  );

  app.delete(
    '/api/v1/me/bilibili-binding',
    {
      preHandler: requireSession,
      schema: { response: { 204: Type.Null() }, tags: ['bilibili-binding'] },
    },
    async (request, reply) => {
      await options.service.unbind({
        ...auditContext(request),
        userId: request.authSession!.user.id,
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/v1/admin/bilibili-binding-conflicts',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        querystring: Type.Object(
          {
            cursor: Type.Optional(Type.String({ maxLength: 512, minLength: 1 })),
            limit: Type.Optional(Type.Integer({ default: 50, maximum: 100, minimum: 1 })),
          },
          { additionalProperties: false },
        ),
        response: { 200: BindingConflictPageSchema },
        tags: ['bilibili-binding'],
      },
    },
    (request) =>
      options.conflicts.listOpen({
        ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        limit: request.query.limit ?? 50,
      }),
  );

  app.post<{ Body: ConflictResolutionBody; Params: ConflictParameters }>(
    '/api/v1/admin/bilibili-binding-conflicts/:conflictId/resolve',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: BindingConflictResolutionInputSchema,
        params: Type.Object({ conflictId: IdSchema }),
        response: { 204: Type.Null() },
        tags: ['bilibili-binding'],
      },
    },
    async (request, reply) => {
      await options.conflicts.resolve({
        ...auditContext(request),
        conflictId: request.params.conflictId,
        reason: request.body.reason,
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Body: ConflictResolutionBody; Params: ConflictParameters }>(
    '/api/v1/admin/bilibili-binding-conflicts/:conflictId/dismiss',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: BindingConflictResolutionInputSchema,
        params: Type.Object({ conflictId: IdSchema }),
        response: { 204: Type.Null() },
        tags: ['bilibili-binding'],
      },
    },
    async (request, reply) => {
      await options.conflicts.dismiss({
        ...auditContext(request),
        conflictId: request.params.conflictId,
        reason: request.body.reason,
      });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

export default bindingRoutes;
