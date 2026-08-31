import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import {
  AnnouncementContentSchema,
  AnnouncementContentUpdateSchema,
  AnnouncementSchema,
  AnnouncementSummaryPageSchema,
  AnnouncementVersionCommandSchema,
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

  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/v1/me/announcements',
    {
      preHandler: requireSession,
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: AnnouncementSummaryPageSchema },
        tags: ['announcements'],
      },
    },
    (request) =>
      options.service.listVisible(session(request).user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit ?? 20,
      }),
  );

  app.get<{ Params: { announcementId: string } }>(
    '/api/v1/me/announcements/:announcementId',
    {
      preHandler: requireSession,
      schema: {
        params: Parameters,
        response: { 200: AnnouncementSchema },
        tags: ['announcements'],
      },
    },
    (request) =>
      options.service.getVisible(session(request).user.id, request.params.announcementId),
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
      mode === 'CREATOR'
        ? ({ creatorId: request.creatorProfile!.id, scope: 'CREATOR' } as const)
        : ({ scope: 'PLATFORM' } as const);

    app.get<{ Querystring: { cursor?: string; limit?: number } }>(
      prefix,
      {
        preHandler: guard,
        schema: {
          querystring: Type.Object({
            cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
            limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
          }),
          response: { 200: AnnouncementSummaryPageSchema },
          tags: ['manage-announcements'],
        },
      },
      (request) =>
        options.service.listManaged(target(request), {
          cursor: request.query.cursor,
          limit: request.query.limit ?? 20,
        }),
    );

    app.post<{ Body: typeof AnnouncementContentSchema.static }>(
      prefix,
      {
        preHandler: guard,
        schema: {
          body: AnnouncementContentSchema,
          response: { 201: AnnouncementSchema },
          tags: ['manage-announcements'],
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(await options.service.createDraft(target(request), request.body, context(request))),
    );

    app.get<{ Params: { announcementId: string } }>(
      `${prefix}/:announcementId`,
      {
        preHandler: guard,
        schema: {
          params: Parameters,
          response: { 200: AnnouncementSchema },
          tags: ['manage-announcements'],
        },
      },
      (request) => options.service.getManaged(target(request), request.params.announcementId),
    );

    app.put<{
      Body: typeof AnnouncementContentUpdateSchema.static;
      Params: { announcementId: string };
    }>(
      `${prefix}/:announcementId`,
      {
        preHandler: guard,
        schema: {
          body: AnnouncementContentUpdateSchema,
          params: Parameters,
          response: { 200: AnnouncementSchema },
          tags: ['manage-announcements'],
        },
      },
      (request) =>
        options.service.saveContent(
          target(request),
          request.params.announcementId,
          request.body,
          context(request),
        ),
    );

    app.post<{
      Body: typeof AnnouncementVersionCommandSchema.static;
      Params: { announcementId: string };
    }>(
      `${prefix}/:announcementId/publish`,
      {
        preHandler: guard,
        schema: {
          body: AnnouncementVersionCommandSchema,
          params: Parameters,
          response: { 200: AnnouncementSchema },
          tags: ['manage-announcements'],
        },
      },
      (request) =>
        options.service.publish(
          target(request),
          request.params.announcementId,
          request.body.expectedVersion,
          context(request),
        ),
    );

    app.post<{
      Body: typeof AnnouncementVersionCommandSchema.static;
      Params: { announcementId: string };
    }>(
      `${prefix}/:announcementId/withdraw`,
      {
        preHandler: guard,
        schema: {
          body: AnnouncementVersionCommandSchema,
          params: Parameters,
          response: { 200: AnnouncementSchema },
          tags: ['manage-announcements'],
        },
      },
      (request) =>
        options.service.withdraw(
          target(request),
          request.params.announcementId,
          request.body.expectedVersion,
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
