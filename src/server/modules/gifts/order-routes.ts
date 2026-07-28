import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { GiftOrderStatus } from '../../infrastructure/db/schema.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireCreator, createRequireSession } from '../auth/guards.js';
import type { GiftOrderService } from './order-service.js';

interface GiftOrderRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: GiftOrderService;
}

const Id = Type.String({ format: 'uuid' });
const Parameters = Type.Object({ giftOrderId: Id });
const EmptyBody = Type.Object({}, { additionalProperties: false });
const Status = Type.Union([
  Type.Literal('CLAIMABLE'),
  Type.Literal('SUBMITTED'),
  Type.Literal('PROCESSING'),
  Type.Literal('SHIPPED'),
  Type.Literal('COMPLETED'),
  Type.Literal('EXPIRED'),
  Type.Literal('CANCELLED'),
]);

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
        response: { 200: Type.Array(Type.Any()) },
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
        response: { 200: Type.Any() },
        tags: ['my-gifts'],
      },
    },
    (request) => options.service.getForUser(session(request).user.id, request.params.giftOrderId),
  );

  app.post<{
    Body: {
      addressId: string;
      expectedVersion: number;
      options: Record<string, boolean | string>;
    };
    Params: { giftOrderId: string };
  }>(
    '/api/v1/me/gifts/:giftOrderId/submit',
    {
      preHandler: requireSession,
      schema: {
        body: Type.Object(
          {
            addressId: Id,
            expectedVersion: Type.Integer({ minimum: 1 }),
            options: Type.Record(
              Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }),
              Type.Union([Type.Boolean(), Type.String({ maxLength: 2_000 })]),
            ),
          },
          { additionalProperties: false },
        ),
        params: Parameters,
        response: { 200: Type.Any() },
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
        querystring: Type.Object({ status: Type.Optional(Status) }),
        response: { 200: Type.Array(Type.Any()) },
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
        response: { 200: Type.Any() },
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
        body: EmptyBody,
        params: Parameters,
        response: { 200: Type.Any() },
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
    Body: {
      carrierCode: string;
      carrierName: string;
      trackingNumber: string;
      trackingUrl?: null | string;
    };
    Params: { giftOrderId: string };
  }>(
    '/api/v1/creator/orders/:giftOrderId/ship',
    {
      preHandler: requireCreator,
      schema: {
        body: Type.Object(
          {
            carrierCode: Type.String({ maxLength: 80, minLength: 1 }),
            carrierName: Type.String({ maxLength: 120, minLength: 1 }),
            trackingNumber: Type.String({ maxLength: 160, minLength: 1 }),
            trackingUrl: Type.Optional(
              Type.Union([Type.Null(), Type.String({ maxLength: 1_000 })]),
            ),
          },
          { additionalProperties: false },
        ),
        params: Parameters,
        response: { 200: Type.Any() },
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
        body: EmptyBody,
        params: Parameters,
        response: { 200: Type.Any() },
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
        response: { 200: Type.Any() },
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
