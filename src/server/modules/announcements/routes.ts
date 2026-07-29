import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import {
  AnnouncementInputSchema,
  AnnouncementSchema,
  AnnouncementUpdateSchema,
} from '../../../shared/contracts/announcements.js';
import { IdSchema } from '../../../shared/contracts/common.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import {
  createRequireCreator,
  createRequirePlatformAdmin,
  createRequireSession,
} from '../auth/guards.js';
import type { AnnouncementService } from './announcement-service.js';

interface AnnouncementRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: AnnouncementService;
}

const Parameters = Type.Object({ announcementId: IdSchema });

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

const announcementRoutes: FastifyPluginAsync<AnnouncementRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);
  const requireCreator = createRequireCreator(options.auth, options.database);
  const requireAdmin = createRequirePlatformAdmin(options.auth);

  app.get<{ Querystring: { limit?: number } }>(
    '/api/v1/me/announcements',
    {
      preHandler: requireSession,
      schema: {
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: Type.Array(AnnouncementSchema) },
        tags: ['announcements'],
      },
    },
    (request) => options.service.listVisible(session(request).user.id, request.query.limit),
  );

  app.post<{ Body: Record<string, never>; Params: { announcementId: string } }>(
    '/api/v1/me/announcements/:announcementId/read',
    {
      preHandler: requireSession,
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        params: Parameters,
        response: { 204: Type.Null() },
        tags: ['announcements'],
      },
    },
    async (request, reply) => {
      await options.service.markRead(session(request).user.id, request.params.announcementId);
      return reply.status(204).send();
    },
  );

  const registerManagedRoutes = (
    prefix: '/api/v1/admin/announcements' | '/api/v1/creator/announcements',
    mode: 'PLATFORM' | 'CREATOR',
  ) => {
    const guard = mode === 'PLATFORM' ? requireAdmin : requireCreator;
    const target = (request: { readonly creatorProfile: null | { readonly id: string } }) =>
      ({
        ...(mode === 'CREATOR' ? { creatorId: request.creatorProfile!.id } : {}),
        scope: mode,
      }) as const;

    app.get(
      prefix,
      {
        preHandler: guard,
        schema: {
          response: { 200: Type.Array(AnnouncementSchema) },
          tags: ['manage-announcements'],
        },
      },
      (request) => {
        const resolved = target(request);
        return options.service.listManaged(resolved.scope, resolved.creatorId);
      },
    );

    app.post<{ Body: typeof AnnouncementInputSchema.static }>(
      prefix,
      {
        preHandler: guard,
        schema: {
          body: AnnouncementInputSchema,
          response: { 201: AnnouncementSchema },
          tags: ['manage-announcements'],
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(await options.service.create(target(request), request.body, context(request))),
    );

    app.put<{
      Body: typeof AnnouncementUpdateSchema.static;
      Params: { announcementId: string };
    }>(
      `${prefix}/:announcementId`,
      {
        preHandler: guard,
        schema: {
          body: AnnouncementUpdateSchema,
          params: Parameters,
          response: { 200: AnnouncementSchema },
          tags: ['manage-announcements'],
        },
      },
      (request) =>
        options.service.update(
          target(request),
          request.params.announcementId,
          request.body,
          context(request),
        ),
    );

    app.delete<{ Params: { announcementId: string } }>(
      `${prefix}/:announcementId`,
      {
        preHandler: guard,
        schema: {
          params: Parameters,
          response: { 204: Type.Null() },
          tags: ['manage-announcements'],
        },
      },
      async (request, reply) => {
        await options.service.deleteDraft(
          target(request),
          request.params.announcementId,
          context(request),
        );
        return reply.status(204).send();
      },
    );
  };

  registerManagedRoutes('/api/v1/creator/announcements', 'CREATOR');
  registerManagedRoutes('/api/v1/admin/announcements', 'PLATFORM');
  return Promise.resolve();
};

export default announcementRoutes;
