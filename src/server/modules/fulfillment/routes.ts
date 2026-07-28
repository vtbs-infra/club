import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireSession } from '../auth/guards.js';
import type {
  CreateShipmentInput,
  FulfillmentFilters,
  FulfillmentService,
} from './fulfillment-service.js';

interface FulfillmentRoutesOptions {
  readonly auth: AppAuth;
  readonly service: FulfillmentService;
}

const Id = Type.String({ format: 'uuid' });
const OrganizationParameters = Type.Object({ orgId: Id });
const OrganizationCreatorParameters = Type.Object({ creatorId: Id, orgId: Id });
const ClaimParameters = Type.Object({ claimId: Id });
const ShipmentParameters = Type.Object({ shipmentId: Id });
const Filters = Type.Object(
  {
    campaignId: Type.Optional(Id),
    creatorId: Type.Optional(Id),
    periodStart: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-01$' })),
    status: Type.Optional(
      Type.Union([
        Type.Literal('SUBMITTED'),
        Type.Literal('PROCESSING'),
        Type.Literal('SHIPPED'),
        Type.Literal('COMPLETED'),
        Type.Literal('CANCELLED'),
      ]),
    ),
  },
  { additionalProperties: false },
);
const CreateShipmentBody = Type.Object(
  {
    carrierCode: Type.String({ maxLength: 80, minLength: 1 }),
    claimEntitlementIds: Type.Optional(Type.Array(Id, { maxItems: 100, minItems: 1 })),
    shipmentKey: Type.String({ maxLength: 120, minLength: 1 }),
    trackingNumber: Type.String({ maxLength: 160, minLength: 1 }),
    trackingUrl: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 2_000 })])),
  },
  { additionalProperties: false },
);
const ImportBody = Type.Object(
  { csv: Type.String({ maxLength: 2_000_000, minLength: 1 }) },
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

function workbookContentDisposition(creatorDisplayName: string, periodStart: string): string {
  const safeCreatorName =
    Array.from(creatorDisplayName, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 || '"*/:<>?\\|'.includes(character) ? '_' : character;
    })
      .join('')
      .trim() || 'creator';
  const period = periodStart.slice(0, 7);
  const utf8Name = `${safeCreatorName}-${period}-当月舰长收货名单.xlsx`;
  const encodedName = encodeURIComponent(utf8Name)
    .replaceAll("'", '%27')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29');
  return `attachment; filename="guard-addresses-${period}.xlsx"; filename*=UTF-8''${encodedName}`;
}

const fulfillmentRoutes: FastifyPluginAsync<FulfillmentRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);

  app.get<{ Params: { orgId: string }; Querystring: FulfillmentFilters }>(
    '/api/v1/organizations/:orgId/fulfillment/claims',
    {
      preHandler: requireSession,
      schema: {
        params: OrganizationParameters,
        querystring: Filters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['fulfillment'],
      },
    },
    async (request) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'claim.read',
      );
      return options.service.listClaims(request.params.orgId, access.creatorIds, request.query);
    },
  );

  app.get<{ Params: { creatorId: string; orgId: string } }>(
    '/api/v1/organizations/:orgId/creators/:creatorId/guards/current-month.xlsx',
    {
      preHandler: requireSession,
      schema: {
        params: OrganizationCreatorParameters,
        response: { 200: Type.Any() },
        tags: ['fulfillment'],
      },
    },
    async (request, reply) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'recipient-address.read',
      );
      const exported = await options.service.exportCurrentMonthGuardAddresses(
        request.params.orgId,
        request.params.creatorId,
        access.creatorIds,
        context(request),
      );
      return reply
        .header(
          'content-disposition',
          workbookContentDisposition(exported.creatorDisplayName, exported.periodStart),
        )
        .header('x-export-row-count', String(exported.rowCount))
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(exported.content);
    },
  );

  app.get<{ Params: { orgId: string }; Querystring: FulfillmentFilters }>(
    '/api/v1/organizations/:orgId/fulfillment/export.csv',
    {
      preHandler: requireSession,
      schema: {
        params: OrganizationParameters,
        querystring: Filters,
        response: { 200: Type.String() },
        tags: ['fulfillment'],
      },
    },
    async (request, reply) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'recipient-address.read',
      );
      const csv = await options.service.exportClaims(
        request.params.orgId,
        access.creatorIds,
        request.query,
        context(request),
      );
      return reply
        .header('content-disposition', 'attachment; filename="club-fulfillment-v1.csv"')
        .type('text/csv; charset=utf-8')
        .send(csv);
    },
  );

  app.get(
    '/api/v1/shipments/export-template',
    {
      preHandler: requireSession,
      schema: { response: { 200: Type.String() }, tags: ['fulfillment'] },
    },
    (_request, reply) =>
      reply
        .header('content-disposition', 'attachment; filename="club-shipment-import-v1.csv"')
        .type('text/csv; charset=utf-8')
        .send(options.service.exportTemplate()),
  );

  app.post<{ Body: { csv: string }; Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId/shipments/import',
    {
      preHandler: requireSession,
      schema: {
        body: ImportBody,
        params: OrganizationParameters,
        response: { 200: Type.Any() },
        tags: ['fulfillment'],
      },
    },
    async (request) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'fulfillment.manage',
      );
      return options.service.importCsv(
        request.params.orgId,
        access.creatorIds,
        request.body.csv,
        context(request),
      );
    },
  );

  app.post<{ Body: CreateShipmentInput; Params: { claimId: string } }>(
    '/api/v1/claims/:claimId/shipments',
    {
      preHandler: requireSession,
      schema: {
        body: CreateShipmentBody,
        params: ClaimParameters,
        response: { 200: Type.Any() },
        tags: ['fulfillment'],
      },
    },
    async (request) => {
      await options.service.assertClaimAccess(
        session(request),
        request.params.claimId,
        'fulfillment.manage',
      );
      return options.service.createShipment(request.params.claimId, request.body, context(request));
    },
  );

  app.get<{ Params: { claimId: string } }>(
    '/api/v1/claims/:claimId/fulfillment',
    {
      preHandler: requireSession,
      schema: {
        params: ClaimParameters,
        response: { 200: Type.Any() },
        tags: ['fulfillment'],
      },
    },
    async (request) => {
      await options.service.assertClaimAccess(
        session(request),
        request.params.claimId,
        'recipient-address.read',
      );
      return options.service.getClaimFulfillment(request.params.claimId, context(request));
    },
  );

  app.get<{ Params: { claimId: string } }>(
    '/api/v1/me/claims/:claimId/shipments',
    {
      preHandler: requireSession,
      schema: {
        params: ClaimParameters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['fulfillment'],
      },
    },
    (request) => options.service.listForUser(session(request).user.id, request.params.claimId),
  );

  app.post<{ Params: { shipmentId: string } }>(
    '/api/v1/shipments/:shipmentId/refresh',
    {
      preHandler: requireSession,
      schema: {
        params: ShipmentParameters,
        response: { 200: Type.Any() },
        tags: ['fulfillment'],
      },
    },
    async (request) => {
      await options.service.assertShipmentAccess(
        session(request),
        request.params.shipmentId,
        'fulfillment.manage',
      );
      return options.service.refreshShipment(request.params.shipmentId, context(request));
    },
  );

  return Promise.resolve();
};

export default fulfillmentRoutes;
