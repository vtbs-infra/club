import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth, AuthSession } from '../auth/auth.js';
import {
  createRequireCreator,
  createRequirePlatformAdmin,
  createRequireSession,
} from '../auth/guards.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { CreatorService } from './creator-service.js';

interface CreatorRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: CreatorService;
}

const Id = Type.String({ format: 'uuid' });
const CreatorBody = Type.Object(
  {
    bilibiliUid: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
    displayName: Type.String({ maxLength: 120, minLength: 1 }),
    roomId: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
    timezone: Type.String({ maxLength: 100, minLength: 1 }),
    userId: Id,
  },
  { additionalProperties: false },
);
const CreatorUpdateBody = Type.Partial(Type.Omit(CreatorBody, ['userId']), { minProperties: 1 });
const OwnUpdateBody = Type.Object(
  {
    displayName: Type.Optional(Type.String({ maxLength: 120, minLength: 1 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

function session(request: { readonly authSession: AuthSession | null }) {
  if (!request.authSession) throw new Error('Authenticated route is missing its session.');
  return request.authSession;
}

function context(request: {
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

const creatorRoutes: FastifyPluginAsync<CreatorRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);
  const requireAdmin = createRequirePlatformAdmin(options.auth);
  const requireCreator = createRequireCreator(options.auth, options.database);

  app.get(
    '/api/v1/me',
    {
      preHandler: requireSession,
      schema: { response: { 200: Type.Any() }, tags: ['identity'] },
    },
    (request) => options.service.getIdentity(session(request).user.id),
  );

  app.get<{ Querystring: { search?: string } }>(
    '/api/v1/admin/users',
    {
      preHandler: requireAdmin,
      schema: {
        querystring: Type.Object({ search: Type.Optional(Type.String({ maxLength: 120 })) }),
        response: { 200: Type.Array(Type.Any()) },
        tags: ['admin-creators'],
      },
    },
    (request) => options.service.listUsers(request.query.search),
  );

  app.get(
    '/api/v1/admin/creators',
    {
      preHandler: requireAdmin,
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['admin-creators'] },
    },
    () => options.service.listCreators(),
  );

  app.get(
    '/api/v1/admin/overview',
    {
      preHandler: requireAdmin,
      schema: { response: { 200: Type.Any() }, tags: ['admin'] },
    },
    () => options.service.summary(),
  );

  app.post<{ Body: typeof CreatorBody.static }>(
    '/api/v1/admin/creators',
    {
      preHandler: requireAdmin,
      schema: {
        body: CreatorBody,
        response: { 201: Type.Any() },
        tags: ['admin-creators'],
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await options.service.create({ ...context(request), ...request.body })),
  );

  app.patch<{ Body: typeof CreatorUpdateBody.static; Params: { creatorId: string } }>(
    '/api/v1/admin/creators/:creatorId',
    {
      preHandler: requireAdmin,
      schema: {
        body: CreatorUpdateBody,
        params: Type.Object({ creatorId: Id }),
        response: { 200: Type.Any() },
        tags: ['admin-creators'],
      },
    },
    (request) =>
      options.service.update({
        ...context(request),
        ...request.body,
        creatorId: request.params.creatorId,
      }),
  );

  app.get(
    '/api/v1/creator/profile',
    {
      preHandler: requireCreator,
      schema: { response: { 200: Type.Any() }, tags: ['creator'] },
    },
    (request) => request.creatorProfile,
  );

  app.patch<{ Body: typeof OwnUpdateBody.static }>(
    '/api/v1/creator/profile',
    {
      preHandler: requireCreator,
      schema: {
        body: OwnUpdateBody,
        response: { 200: Type.Any() },
        tags: ['creator'],
      },
    },
    (request) =>
      options.service.updateOwn(request.creatorProfile!.id, {
        ...context(request),
        ...request.body,
      }),
  );

  return Promise.resolve();
};

export default creatorRoutes;
