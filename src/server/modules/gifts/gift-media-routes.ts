import { Readable } from 'node:stream';

import multipart from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireCreator } from '../auth/guards.js';
import type { GiftMediaService } from './gift-media-service.js';

interface GiftMediaRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: GiftMediaService;
}

function context(request: {
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

const giftMediaRoutes: FastifyPluginAsync<GiftMediaRoutesOptions> = async (app, options) => {
  await app.register(multipart, {
    limits: { fields: 0, fileSize: 5 * 1024 * 1024, files: 1 },
  });
  const requireCreator = createRequireCreator(options.auth, options.database);
  const parameters = Type.Object({ releaseId: Type.String({ format: 'uuid' }) });

  app.get<{ Params: { releaseId: string } }>(
    '/api/v1/gift-releases/:releaseId/cover',
    {
      schema: { params: parameters, tags: ['gift-media'] },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'public, max-age=3600')
        .header('content-disposition', 'inline')
        .type('image/webp')
        .send(Readable.fromWeb(await options.service.openCover(request.params.releaseId))),
  );

  app.post<{ Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId/cover',
    {
      preHandler: requireCreator,
      schema: {
        consumes: ['multipart/form-data'],
        params: parameters,
        response: { 200: Type.Object({ coverImageUrl: Type.String() }) },
        tags: ['gift-media'],
      },
    },
    async (request) => {
      const file = await request.file();
      if (!file) throw new AppError('GIFT_COVER_REQUIRED', 'Choose an image to upload.', 400);
      return options.service.uploadCover(request.creatorProfile!.id, request.params.releaseId, {
        ...context(request),
        bytes: await file.toBuffer(),
        mimeType: file.mimetype,
      });
    },
  );

  app.delete<{ Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId/cover',
    {
      preHandler: requireCreator,
      schema: { params: parameters, response: { 204: Type.Null() }, tags: ['gift-media'] },
    },
    async (request, reply) => {
      await options.service.removeCover(
        request.creatorProfile!.id,
        request.params.releaseId,
        context(request),
      );
      return reply.status(204).send();
    },
  );
};

export default giftMediaRoutes;
