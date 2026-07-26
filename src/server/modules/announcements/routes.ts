import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import {
  createRequireOrganizationPermission,
  createRequirePlatformAdmin,
  createRequireSession,
} from '../auth/guards.js';
import type {
  AnnouncementService,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from './announcement-service.js';

interface AnnouncementRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: AnnouncementService;
}

const Id = Type.String({ format: 'uuid' });
const AnnouncementParameters = Type.Object({ announcementId: Id });
const OrganizationParameters = Type.Object({ orgId: Id });
const Severity = Type.Union([
  Type.Literal('INFO'),
  Type.Literal('WARNING'),
  Type.Literal('CRITICAL'),
]);
const DateOrNull = Type.Union([Type.Null(), Type.String({ format: 'date-time' })]);
const SharedCreateBody = {
  body: Type.String({ maxLength: 10_000, minLength: 1 }),
  expiresAt: Type.Optional(DateOrNull),
  pinned: Type.Boolean(),
  publishedAt: Type.Optional(DateOrNull),
  severity: Severity,
  title: Type.String({ maxLength: 160, minLength: 1 }),
};
const OrganizationCreateBody = Type.Object(
  {
    ...SharedCreateBody,
    campaignId: Type.Optional(Type.Union([Type.Null(), Id])),
    creatorId: Type.Optional(Type.Union([Type.Null(), Id])),
    scope: Type.Union([
      Type.Literal('ORGANIZATION'),
      Type.Literal('CREATOR'),
      Type.Literal('CAMPAIGN'),
    ]),
  },
  { additionalProperties: false },
);
const PlatformCreateBody = Type.Object(SharedCreateBody, { additionalProperties: false });
const UpdateBody = Type.Object(
  {
    body: Type.Optional(SharedCreateBody.body),
    expiresAt: Type.Optional(DateOrNull),
    pinned: Type.Optional(SharedCreateBody.pinned),
    publishedAt: Type.Optional(DateOrNull),
    severity: Type.Optional(Severity),
    title: Type.Optional(SharedCreateBody.title),
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
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

function optionalDate(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(value);
}

const announcementRoutes: FastifyPluginAsync<AnnouncementRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);
  const requireAnnouncementManager = createRequireOrganizationPermission(
    options.auth,
    options.database,
    'announcement.manage',
  );
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/me/announcements',
    {
      preHandler: requireSession,
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['announcements'] },
    },
    (request) => options.service.listForUser(session(request).user.id),
  );

  app.post<{ Params: { announcementId: string } }>(
    '/api/v1/me/announcements/:announcementId/read',
    {
      preHandler: requireSession,
      schema: {
        params: AnnouncementParameters,
        response: { 200: Type.Any() },
        tags: ['announcements'],
      },
    },
    (request) => options.service.markRead(session(request).user.id, request.params.announcementId),
  );

  app.get<{ Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId/announcements',
    {
      preHandler: requireAnnouncementManager,
      schema: {
        params: OrganizationParameters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['announcements'],
      },
    },
    (request) =>
      options.service.listOrganization(
        request.params.orgId,
        request.organizationAccess?.creatorIds ?? [],
      ),
  );

  app.post<{
    Body: Omit<CreateAnnouncementInput, 'expiresAt' | 'publishedAt'> & {
      expiresAt?: string | null;
      publishedAt?: string | null;
    };
    Params: { orgId: string };
  }>(
    '/api/v1/organizations/:orgId/announcements',
    {
      preHandler: requireAnnouncementManager,
      schema: {
        body: OrganizationCreateBody,
        params: OrganizationParameters,
        response: { 201: Type.Any() },
        tags: ['announcements'],
      },
    },
    async (request, reply) =>
      reply.status(201).send(
        await options.service.createOrganization(
          request.params.orgId,
          {
            ...request.body,
            expiresAt: optionalDate(request.body.expiresAt),
            publishedAt: optionalDate(request.body.publishedAt),
          },
          context(request),
          request.organizationAccess?.creatorIds ?? [],
        ),
      ),
  );

  app.get(
    '/api/v1/platform/announcements',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['announcements'] },
    },
    () => options.service.listPlatform(),
  );

  app.post<{
    Body: Omit<
      CreateAnnouncementInput,
      'campaignId' | 'creatorId' | 'expiresAt' | 'publishedAt' | 'scope'
    > & {
      expiresAt?: string | null;
      publishedAt?: string | null;
    };
  }>(
    '/api/v1/platform/announcements',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: PlatformCreateBody,
        response: { 201: Type.Any() },
        tags: ['announcements'],
      },
    },
    async (request, reply) =>
      reply.status(201).send(
        await options.service.createPlatform(
          {
            ...request.body,
            expiresAt: optionalDate(request.body.expiresAt),
            publishedAt: optionalDate(request.body.publishedAt),
          },
          context(request),
        ),
      ),
  );

  app.patch<{
    Body: Omit<UpdateAnnouncementInput, 'expiresAt' | 'publishedAt'> & {
      expiresAt?: string | null;
      publishedAt?: string | null;
    };
    Params: { announcementId: string };
  }>(
    '/api/v1/announcements/:announcementId',
    {
      preHandler: requireSession,
      schema: {
        body: UpdateBody,
        params: AnnouncementParameters,
        response: { 200: Type.Any() },
        tags: ['announcements'],
      },
    },
    async (request) => {
      await options.service.assertManagementAccess(session(request), request.params.announcementId);
      return options.service.update(
        request.params.announcementId,
        {
          ...request.body,
          expiresAt: optionalDate(request.body.expiresAt),
          publishedAt: optionalDate(request.body.publishedAt),
        },
        context(request),
      );
    },
  );

  return Promise.resolve();
};

export default announcementRoutes;
