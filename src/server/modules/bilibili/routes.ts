import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  BilibiliLoginAttemptSchema,
  BilibiliRevisionInputSchema,
  BilibiliSessionStatusSchema,
} from '../../../shared/contracts/bilibili.js';
import { IdSchema } from '../../../shared/contracts/common.js';
import type { AppAuth } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import { sessionDigest } from '../auth/session-store.js';
import type { BilibiliLoginOwner, BilibiliSessionService } from './session-service.js';

const EmptyBody = Type.Object({}, { additionalProperties: false });
const Parameters = Type.Object({ id: IdSchema }, { additionalProperties: false });
function owner(request: FastifyRequest): BilibiliLoginOwner {
  if (!request.authSession) throw new Error('Authenticated route is missing its session.');
  return {
    actorUserId: request.authSession.user.id,
    clubSessionId: sessionDigest(request.session.sessionId),
    requestId: request.id,
    ipAddress: request.ip,
  };
}

const bilibiliRoutes: FastifyPluginAsync<{
  readonly auth: AppAuth;
  readonly service: BilibiliSessionService;
}> = (app, { auth, service }) => {
  const preHandler = createRequirePlatformAdmin(auth);
  const prefix = '/api/v1/admin/bilibili';
  app.get(
    prefix,
    { preHandler, schema: { tags: ['bilibili'], response: { 200: BilibiliSessionStatusSchema } } },
    (request) => service.status(owner(request)),
  );
  app.post(
    prefix + '/login-attempts',
    {
      preHandler,
      schema: {
        tags: ['bilibili'],
        body: EmptyBody,
        response: { 201: BilibiliLoginAttemptSchema },
      },
    },
    async (request, reply) => reply.status(201).send(await service.createLogin(owner(request))),
  );
  app.get<{ Params: typeof Parameters.static }>(
    prefix + '/login-attempts/:id',
    {
      preHandler,
      schema: {
        tags: ['bilibili'],
        params: Parameters,
        response: { 200: BilibiliLoginAttemptSchema },
      },
    },
    (request) => service.getLogin(request.params.id, owner(request)),
  );
  app.delete<{ Params: typeof Parameters.static }>(
    prefix + '/login-attempts/:id',
    { preHandler, schema: { tags: ['bilibili'], params: Parameters } },
    async (request, reply) => {
      await service.cancelLogin(request.params.id, owner(request));
      return reply.status(204).send();
    },
  );
  app.post<{ Params: typeof Parameters.static }>(
    prefix + '/login-attempts/:id/activate',
    {
      preHandler,
      schema: {
        tags: ['bilibili'],
        params: Parameters,
        body: EmptyBody,
        response: { 200: BilibiliSessionStatusSchema },
      },
    },
    (request) => service.activateLogin(request.params.id, owner(request)),
  );
  app.post(
    prefix + '/check',
    {
      preHandler,
      schema: {
        tags: ['bilibili'],
        body: EmptyBody,
        response: { 200: BilibiliSessionStatusSchema },
      },
    },
    (request) => service.requestCheck(owner(request)),
  );
  app.delete<{ Body: typeof BilibiliRevisionInputSchema.static }>(
    prefix + '/session',
    {
      preHandler,
      schema: {
        tags: ['bilibili'],
        body: BilibiliRevisionInputSchema,
        response: { 200: BilibiliSessionStatusSchema },
      },
    },
    (request) => service.disconnect(request.body.revision, owner(request)),
  );
  return Promise.resolve();
};
export default bilibiliRoutes;
