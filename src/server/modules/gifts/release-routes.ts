import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { EmptyBodySchema, IdSchema } from '../../../shared/contracts/common.js';
import {
  GiftReleaseSchema,
  GiftReleaseSummaryPageSchema,
  ReleaseInputSchema,
  ReleasePublishInputSchema,
  ReleaseUpdateInputSchema,
} from '../../../shared/contracts/gifts.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireCreator } from '../auth/guards.js';
import type { GiftReleaseService } from './release-service.js';

interface GiftReleaseRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: GiftReleaseService;
}

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

const giftReleaseRoutes: FastifyPluginAsync<GiftReleaseRoutesOptions> = (app, options) => {
  const requireCreator = createRequireCreator(options.auth, options.database);
  const parameters = Type.Object({ releaseId: IdSchema });

  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/v1/creator/releases',
    {
      preHandler: requireCreator,
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: GiftReleaseSummaryPageSchema },
        tags: ['creator-gifts'],
      },
    },
    (request) =>
      options.service.list(request.creatorProfile!.id, {
        cursor: request.query.cursor,
        limit: request.query.limit ?? 24,
      }),
  );

  app.post<{ Body: typeof ReleaseInputSchema.static }>(
    '/api/v1/creator/releases',
    {
      preHandler: requireCreator,
      schema: {
        body: ReleaseInputSchema,
        response: { 201: GiftReleaseSchema },
        tags: ['creator-gifts'],
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await options.service.create(request.creatorProfile!.id, request.body, context(request)),
        ),
  );

  app.get<{ Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId',
    {
      preHandler: requireCreator,
      schema: {
        params: parameters,
        response: { 200: GiftReleaseSchema },
        tags: ['creator-gifts'],
      },
    },
    (request) => options.service.get(request.creatorProfile!.id, request.params.releaseId),
  );

  app.put<{ Body: typeof ReleaseUpdateInputSchema.static; Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId',
    {
      preHandler: requireCreator,
      schema: {
        body: ReleaseUpdateInputSchema,
        params: parameters,
        response: { 200: GiftReleaseSchema },
        tags: ['creator-gifts'],
      },
    },
    (request) =>
      options.service.update(
        request.creatorProfile!.id,
        request.params.releaseId,
        request.body,
        context(request),
      ),
  );

  app.post<{ Body: typeof ReleasePublishInputSchema.static; Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId/publish',
    {
      preHandler: requireCreator,
      schema: {
        body: ReleasePublishInputSchema,
        params: parameters,
        response: { 200: GiftReleaseSchema },
        tags: ['creator-gifts'],
      },
    },
    (request) =>
      options.service.publish(
        request.creatorProfile!.id,
        request.params.releaseId,
        request.body,
        context(request),
      ),
  );

  app.post<{ Body: Record<string, never>; Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId/close',
    {
      preHandler: requireCreator,
      schema: {
        body: EmptyBodySchema,
        params: parameters,
        response: { 200: GiftReleaseSchema },
        tags: ['creator-gifts'],
      },
    },
    (request) =>
      options.service.close(request.creatorProfile!.id, request.params.releaseId, context(request)),
  );

  app.delete<{ Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId',
    {
      preHandler: requireCreator,
      schema: {
        params: parameters,
        response: { 204: Type.Null() },
        tags: ['creator-gifts'],
      },
    },
    async (request, reply) => {
      await options.service.removeDraft(
        request.creatorProfile!.id,
        request.params.releaseId,
        context(request),
      );
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

export default giftReleaseRoutes;
