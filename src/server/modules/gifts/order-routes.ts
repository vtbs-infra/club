import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { EmptyBodySchema, IdSchema } from '../../../shared/contracts/common.js';
import {
  CreatorOrderSchema,
  GiftOrderSchema,
  GiftOrderStatusSchema,
  ShipGiftSchema,
  SubmitGiftSchema,
  type GiftOrderStatus,
} from '../../../shared/contracts/gifts.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireCreator, createRequireSession } from '../auth/guards.js';
import type { GiftOrderService } from './order-service.js';

interface GiftOrderRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: GiftOrderService;
}

const Parameters = Type.Object({ giftOrderId: IdSchema });

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

const giftOrderRoutes: FastifyPluginAsync<GiftOrderRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);
  const requireCreator = createRequireCreator(options.auth, options.database);

  app.get<{ Querystring: { limit?: number } }>(
    '/api/v1/me/gifts',
    {
      preHandler: requireSession,
      schema: {
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: Type.Array(GiftOrderSchema) },
        tags: ['my-gifts'],
      },
    },
    (request) => options.service.listForUser(session(request).user.id, request.query.limit),
  );

  app.get<{ Params: { giftOrderId: string } }>(
    '/api/v1/me/gifts/:giftOrderId',
    {
      preHandler: requireSession,
      schema: {
        params: Parameters,
        response: { 200: GiftOrderSchema },
        tags: ['my-gifts'],
      },
    },
    (request) => options.service.getForUser(session(request).user.id, request.params.giftOrderId),
  );

  app.post<{
    Body: typeof SubmitGiftSchema.static;
    Params: { giftOrderId: string };
  }>(
    '/api/v1/me/gifts/:giftOrderId/submit',
    {
      preHandler: requireSession,
      schema: {
        body: SubmitGiftSchema,
        params: Parameters,
        response: { 200: GiftOrderSchema },
        tags: ['my-gifts'],
      },
    },
    (request) =>
      options.service.submit(
        session(request).user.id,
        request.params.giftOrderId,
        request.body,
        context(request),
      ),
  );

  app.get<{ Querystring: { status?: GiftOrderStatus } }>(
    '/api/v1/creator/orders',
    {
      preHandler: requireCreator,
      schema: {
        querystring: Type.Object({ status: Type.Optional(GiftOrderStatusSchema) }),
        response: { 200: Type.Array(GiftOrderSchema) },
        tags: ['creator-orders'],
      },
    },
    (request) => options.service.listForCreator(request.creatorProfile!.id, request.query.status),
  );

  app.get<{ Params: { giftOrderId: string } }>(
    '/api/v1/creator/orders/:giftOrderId',
    {
      preHandler: requireCreator,
      schema: {
        params: Parameters,
        response: { 200: CreatorOrderSchema },
        tags: ['creator-orders'],
      },
    },
    (request) =>
      options.service.getForCreator(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        context(request),
      ),
  );

  app.post<{ Body: Record<string, never>; Params: { giftOrderId: string } }>(
    '/api/v1/creator/orders/:giftOrderId/process',
    {
      preHandler: requireCreator,
      schema: {
        body: EmptyBodySchema,
        params: Parameters,
        response: { 200: CreatorOrderSchema },
        tags: ['creator-orders'],
      },
    },
    async (request) => {
      await options.service.markProcessing(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        context(request),
      );
      return options.service.getForCreator(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        context(request),
      );
    },
  );

  app.post<{
    Body: typeof ShipGiftSchema.static;
    Params: { giftOrderId: string };
  }>(
    '/api/v1/creator/orders/:giftOrderId/ship',
    {
      preHandler: requireCreator,
      schema: {
        body: ShipGiftSchema,
        params: Parameters,
        response: { 200: CreatorOrderSchema },
        tags: ['creator-orders'],
      },
    },
    (request) =>
      options.service.ship(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        request.body,
        context(request),
      ),
  );

  app.post<{ Body: Record<string, never>; Params: { giftOrderId: string } }>(
    '/api/v1/creator/orders/:giftOrderId/complete',
    {
      preHandler: requireCreator,
      schema: {
        body: EmptyBodySchema,
        params: Parameters,
        response: { 200: CreatorOrderSchema },
        tags: ['creator-orders'],
      },
    },
    async (request) => {
      await options.service.complete(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        context(request),
      );
      return options.service.getForCreator(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        context(request),
      );
    },
  );

  app.post<{ Body: { reason: string }; Params: { giftOrderId: string } }>(
    '/api/v1/creator/orders/:giftOrderId/cancel',
    {
      preHandler: requireCreator,
      schema: {
        body: Type.Object(
          { reason: Type.String({ maxLength: 500, minLength: 3 }) },
          { additionalProperties: false },
        ),
        params: Parameters,
        response: { 200: CreatorOrderSchema },
        tags: ['creator-orders'],
      },
    },
    async (request) => {
      await options.service.cancel(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        request.body.reason,
        context(request),
      );
      return options.service.getForCreator(
        request.creatorProfile!.id,
        request.params.giftOrderId,
        context(request),
      );
    },
  );

  return Promise.resolve();
};

export default giftOrderRoutes;
