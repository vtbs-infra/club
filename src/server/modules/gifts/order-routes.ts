import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { EmptyBodySchema, IdSchema } from '../../../shared/contracts/common.js';
import {
  CreatorOrderOverviewSchema,
  CreatorOrderSchema,
  FulfillmentReleaseSummaryPageSchema,
  FulfillmentExportInputSchema,
  GiftOrderListFilterSchema,
  GiftOrderSchema,
  GiftOrderStatusSchema,
  GiftOrderSummaryPageSchema,
  ShipGiftSchema,
  SubmitGiftSchema,
  type GiftOrderListFilter,
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

function safeFilePart(value: string): string {
  return (
    Array.from(value, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 || '"*/:<>?\\|'.includes(character) ? '_' : character;
    })
      .join('')
      .trim()
      .slice(0, 80) || 'gift'
  );
}

function workbookContentDisposition(input: {
  readonly creatorDisplayName: string;
  readonly eligibilityMonth: string;
  readonly generatedAt: Date;
  readonly releaseTitle: string;
}): string {
  const month = input.eligibilityMonth.slice(0, 7);
  const timestamp = input.generatedAt
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const utf8Name = `${safeFilePart(input.creatorDisplayName)}-${month}-${safeFilePart(input.releaseTitle)}-待发货清单-${timestamp}.xlsx`;
  const encodedName = encodeURIComponent(utf8Name)
    .replaceAll("'", '%27')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29');
  return `attachment; filename="fulfillment-${month}-${timestamp}.xlsx"; filename*=UTF-8''${encodedName}`;
}

const giftOrderRoutes: FastifyPluginAsync<GiftOrderRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);
  const requireCreator = createRequireCreator(options.auth, options.database);

  app.get<{
    Querystring: { cursor?: string; filter?: GiftOrderListFilter; limit?: number };
  }>(
    '/api/v1/me/gifts',
    {
      preHandler: requireSession,
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          filter: Type.Optional(GiftOrderListFilterSchema),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: GiftOrderSummaryPageSchema },
        tags: ['my-gifts'],
      },
    },
    (request) =>
      options.service.listForUser(session(request).user.id, {
        cursor: request.query.cursor,
        filter: request.query.filter ?? 'ALL',
        limit: request.query.limit ?? 24,
      }),
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

  app.get<{
    Querystring: { cursor?: string; limit?: number; search?: string; status?: GiftOrderStatus };
  }>(
    '/api/v1/creator/orders',
    {
      preHandler: requireCreator,
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
          search: Type.Optional(Type.String({ maxLength: 80 })),
          status: Type.Optional(GiftOrderStatusSchema),
        }),
        response: { 200: GiftOrderSummaryPageSchema },
        tags: ['creator-orders'],
      },
    },
    (request) =>
      options.service.listForCreator(request.creatorProfile!.id, {
        cursor: request.query.cursor,
        limit: request.query.limit ?? 50,
        search: request.query.search,
        status: request.query.status,
      }),
  );

  app.get(
    '/api/v1/creator/orders/overview',
    {
      preHandler: requireCreator,
      schema: {
        response: { 200: CreatorOrderOverviewSchema },
        tags: ['creator-orders'],
      },
    },
    (request) => options.service.overviewForCreator(request.creatorProfile!.id),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/v1/creator/orders/fulfillment-releases',
    {
      preHandler: requireCreator,
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String({ maxLength: 1_000 })),
          limit: Type.Optional(Type.Integer({ maximum: 100, minimum: 1 })),
        }),
        response: { 200: FulfillmentReleaseSummaryPageSchema },
        tags: ['creator-orders'],
      },
    },
    (request) =>
      options.service.listFulfillmentReleases(request.creatorProfile!.id, {
        cursor: request.query.cursor,
        limit: request.query.limit ?? 50,
      }),
  );

  app.post<{ Body: typeof FulfillmentExportInputSchema.static }>(
    '/api/v1/creator/orders/fulfillment-export',
    {
      preHandler: requireCreator,
      schema: {
        body: FulfillmentExportInputSchema,
        tags: ['creator-orders'],
      },
    },
    async (request, reply) => {
      const exported = await options.service.exportFulfillment(
        request.creatorProfile!,
        request.body.releaseId,
        context(request),
      );
      return reply
        .header(
          'content-disposition',
          workbookContentDisposition({
            creatorDisplayName: exported.creatorDisplayName,
            eligibilityMonth: exported.eligibilityMonth,
            generatedAt: exported.generatedAt,
            releaseTitle: exported.releaseTitle,
          }),
        )
        .header('x-export-row-count', String(exported.rowCount))
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(exported.content);
    },
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
