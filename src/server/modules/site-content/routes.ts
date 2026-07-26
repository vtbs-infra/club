import { Readable } from 'node:stream';

import multipart from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../../shared/errors/app-error.js';
import type { SitePageContent } from '../../../shared/site-content.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import type { SiteAssetsService } from './site-assets-service.js';
import type { SiteContentService } from './site-content-service.js';

interface SiteContentRoutesOptions {
  readonly assets: SiteAssetsService;
  readonly auth: AppAuth;
  readonly service: SiteContentService;
}

interface DraftBody {
  readonly content: SitePageContent;
  readonly expectedDraftId: string | null;
}

interface PublishBody {
  readonly expectedDraftId: string;
}

interface RestoreBody {
  readonly expectedDraftId: string | null;
  readonly versionId: string;
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

const DraftIdSchema = Type.Union([Type.Null(), Type.String({ format: 'uuid' })]);

const siteContentRoutes: FastifyPluginAsync<SiteContentRoutesOptions> = async (app, options) => {
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  });
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/site/home',
    {
      schema: { response: { 200: Type.Any() }, tags: ['site-content'] },
    },
    async (request) => {
      const session = await options.auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      return options.service.getPublic(session?.user.id ?? null);
    },
  );

  app.get<{ Params: { assetId: string }; Querystring: { variant?: 'thumbnail' } }>(
    '/api/v1/site-assets/:assetId',
    {
      schema: {
        params: Type.Object({ assetId: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({
          variant: Type.Optional(Type.Literal('thumbnail')),
        }),
        tags: ['site-content'],
      },
    },
    async (request, reply) => {
      const opened = await options.assets.open(
        request.params.assetId,
        request.query.variant === 'thumbnail',
      );
      return reply
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('content-disposition', 'inline')
        .type(opened.asset.mimeType)
        .send(Readable.fromWeb(opened.stream));
    },
  );

  app.get(
    '/api/v1/platform/site/home',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 200: Type.Any() }, tags: ['site-content'] },
    },
    () => options.service.getAdmin(),
  );

  app.get(
    '/api/v1/platform/site/home/preview',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 200: Type.Any() }, tags: ['site-content'] },
    },
    async (request) => {
      const state = await options.service.getAdmin();
      const home = await options.service.getPublic(request.authSession?.user.id ?? null);
      return { ...home, content: state.draft.content };
    },
  );

  app.put<{ Body: DraftBody }>(
    '/api/v1/platform/site/home/draft',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: Type.Object({
          content: Type.Any(),
          expectedDraftId: DraftIdSchema,
        }),
        response: { 200: Type.Any() },
        tags: ['site-content'],
      },
    },
    (request) =>
      options.service.saveDraft({
        ...auditContext(request),
        content: request.body.content,
        expectedDraftId: request.body.expectedDraftId,
      }),
  );

  app.post<{ Body: PublishBody }>(
    '/api/v1/platform/site/home/publish',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: Type.Object({ expectedDraftId: Type.String({ format: 'uuid' }) }),
        response: { 200: Type.Any() },
        tags: ['site-content'],
      },
    },
    (request) =>
      options.service.publish({
        ...auditContext(request),
        expectedDraftId: request.body.expectedDraftId,
      }),
  );

  app.post<{ Body: RestoreBody }>(
    '/api/v1/platform/site/home/restore',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: Type.Object({
          expectedDraftId: DraftIdSchema,
          versionId: Type.String({ format: 'uuid' }),
        }),
        response: { 200: Type.Any() },
        tags: ['site-content'],
      },
    },
    (request) =>
      options.service.restore({
        ...auditContext(request),
        expectedDraftId: request.body.expectedDraftId,
        versionId: request.body.versionId,
      }),
  );

  app.get(
    '/api/v1/platform/site-assets',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 200: Type.Any() }, tags: ['site-content'] },
    },
    () => options.assets.list(),
  );

  app.post(
    '/api/v1/platform/site-assets',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 201: Type.Any() }, tags: ['site-content'] },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) throw new AppError('SITE_ASSET_REQUIRED', 'Choose an image to upload.', 400);
      const bytes = await file.toBuffer();
      const asset = await options.assets.upload({
        ...auditContext(request),
        bytes,
        filename: file.filename,
        mimeType: file.mimetype,
      });
      return reply.status(201).send(asset);
    },
  );

  app.delete<{ Params: { assetId: string } }>(
    '/api/v1/platform/site-assets/:assetId',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        params: Type.Object({ assetId: Type.String({ format: 'uuid' }) }),
        response: { 204: Type.Null() },
        tags: ['site-content'],
      },
    },
    async (request, reply) => {
      await options.assets.delete({
        ...auditContext(request),
        assetId: request.params.assetId,
      });
      return reply.status(204).send();
    },
  );
};

export default siteContentRoutes;
