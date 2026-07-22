import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireSession } from '../auth/guards.js';
import type { CampaignService } from './campaign-service.js';

interface CampaignRoutesOptions {
  readonly auth: AppAuth;
  readonly service: CampaignService;
}

const Id = Type.String({ format: 'uuid' });
const OrganizationParameters = Type.Object({ orgId: Id });
const CampaignParameters = Type.Object({ campaignId: Id });
const EntitlementParameters = Type.Object({ entitlementId: Id });
const EmptyBody = Type.Object({}, { additionalProperties: false });
const ClaimField = Type.Object(
  {
    key: Type.String({ maxLength: 40, minLength: 1, pattern: '^[a-z][a-z0-9_]*$' }),
    label: Type.String({ maxLength: 80, minLength: 1 }),
    options: Type.Optional(
      Type.Array(Type.String({ maxLength: 80, minLength: 1 }), { maxItems: 30 }),
    ),
    required: Type.Boolean(),
    type: Type.Union([Type.Literal('TEXT'), Type.Literal('LONG_TEXT'), Type.Literal('SELECT')]),
  },
  { additionalProperties: false },
);
const CampaignComposition = Type.Object(
  {
    packages: Type.Array(
      Type.Object(
        {
          description: Type.String({ maxLength: 2_000 }),
          items: Type.Array(
            Type.Object(
              {
                description: Type.String({ maxLength: 1_000 }),
                name: Type.String({ maxLength: 120, minLength: 1 }),
                quantity: Type.Integer({ maximum: 1000, minimum: 1 }),
              },
              { additionalProperties: false },
            ),
            { maxItems: 50, minItems: 1 },
          ),
          key: Type.String({ maxLength: 40, minLength: 1, pattern: '^[a-zA-Z0-9_-]+$' }),
          name: Type.String({ maxLength: 100, minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 20, minItems: 1 },
    ),
    tierRules: Type.Array(
      Type.Object(
        {
          packageKey: Type.String({ maxLength: 40, minLength: 1 }),
          tier: Type.Union([
            Type.Literal('CAPTAIN'),
            Type.Literal('ADMIRAL'),
            Type.Literal('GOVERNOR'),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 3, minItems: 1 },
    ),
  },
  { additionalProperties: false },
);
const CreateBody = Type.Object(
  {
    claimDeadlineAt: Type.String({ format: 'date-time' }),
    claimFormSchema: Type.Array(ClaimField, { maxItems: 20 }),
    claimStartAt: Type.String({ format: 'date-time' }),
    creatorId: Id,
    description: Type.String({ maxLength: 10_000 }),
    fulfillmentMode: Type.Union([Type.Literal('HIGHEST_ONLY'), Type.Literal('CUMULATIVE')]),
    periodStart: Type.String({ format: 'date' }),
    title: Type.String({ maxLength: 160, minLength: 1 }),
  },
  { additionalProperties: false },
);
const UpdateBody = Type.Partial(
  Type.Object(
    {
      claimDeadlineAt: Type.String({ format: 'date-time' }),
      claimFormSchema: Type.Array(ClaimField, { maxItems: 20 }),
      claimStartAt: Type.String({ format: 'date-time' }),
      composition: CampaignComposition,
      description: Type.String({ maxLength: 10_000 }),
      fulfillmentMode: Type.Union([Type.Literal('HIGHEST_ONLY'), Type.Literal('CUMULATIVE')]),
      periodStart: Type.String({ format: 'date' }),
      title: Type.String({ maxLength: 160, minLength: 1 }),
    },
    { additionalProperties: false },
  ),
);

function session(request: { readonly authSession: AuthSession | null }) {
  if (!request.authSession) throw new Error('Authenticated route is missing its session.');
  return request.authSession;
}

function auditContext(request: {
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

const campaignRoutes: FastifyPluginAsync<CampaignRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);

  app.get<{ Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId/campaigns',
    {
      preHandler: requireSession,
      schema: {
        params: OrganizationParameters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['campaigns'],
      },
    },
    async (request) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'read',
      );
      return options.service.list(request.params.orgId, access.creatorIds);
    },
  );

  app.post<{
    Body: {
      claimDeadlineAt: string;
      claimFormSchema: unknown[];
      claimStartAt: string;
      creatorId: string;
      description: string;
      fulfillmentMode: 'HIGHEST_ONLY' | 'CUMULATIVE';
      periodStart: string;
      title: string;
    };
    Params: { orgId: string };
  }>(
    '/api/v1/organizations/:orgId/campaigns',
    {
      preHandler: requireSession,
      schema: {
        body: CreateBody,
        params: OrganizationParameters,
        response: { 201: Type.Any() },
        tags: ['campaigns'],
      },
    },
    async (request, reply) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'manage',
      );
      if (access.creatorIds.length > 0 && !access.creatorIds.includes(request.body.creatorId)) {
        return reply.status(403).send({
          error: {
            code: 'CAMPAIGN_ACCESS_DENIED',
            message: 'Campaign access denied.',
            requestId: request.id,
          },
        });
      }
      const campaign = await options.service.create(
        request.params.orgId,
        {
          ...request.body,
          claimDeadlineAt: new Date(request.body.claimDeadlineAt),
          claimStartAt: new Date(request.body.claimStartAt),
        },
        auditContext(request),
      );
      return reply.status(201).send(campaign);
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    {
      preHandler: requireSession,
      schema: { params: CampaignParameters, response: { 200: Type.Any() }, tags: ['campaigns'] },
    },
    async (request) => {
      await options.service.assertCampaignAccess(
        session(request),
        request.params.campaignId,
        'read',
      );
      return options.service.getDetail(request.params.campaignId);
    },
  );

  app.patch<{
    Body: {
      claimDeadlineAt?: string;
      claimFormSchema?: unknown[];
      claimStartAt?: string;
      composition?: Parameters<CampaignService['update']>[1]['composition'];
      description?: string;
      fulfillmentMode?: 'HIGHEST_ONLY' | 'CUMULATIVE';
      periodStart?: string;
      title?: string;
    };
    Params: { campaignId: string };
  }>(
    '/api/v1/campaigns/:campaignId',
    {
      preHandler: requireSession,
      schema: {
        body: UpdateBody,
        params: CampaignParameters,
        response: { 200: Type.Any() },
        tags: ['campaigns'],
      },
    },
    async (request) => {
      await options.service.assertCampaignAccess(
        session(request),
        request.params.campaignId,
        'manage',
      );
      const { claimDeadlineAt, claimStartAt, ...remaining } = request.body;
      return options.service.update(
        request.params.campaignId,
        {
          ...remaining,
          ...(claimDeadlineAt ? { claimDeadlineAt: new Date(claimDeadlineAt) } : {}),
          ...(claimStartAt ? { claimStartAt: new Date(claimStartAt) } : {}),
        },
        auditContext(request),
      );
    },
  );

  for (const action of ['publish', 'close', 'archive'] as const) {
    app.post<{ Body: Record<string, never>; Params: { campaignId: string } }>(
      `/api/v1/campaigns/:campaignId/${action}`,
      {
        preHandler: requireSession,
        schema: {
          body: EmptyBody,
          params: CampaignParameters,
          response: { 200: Type.Any() },
          tags: ['campaigns'],
        },
      },
      async (request) => {
        await options.service.assertCampaignAccess(
          session(request),
          request.params.campaignId,
          'manage',
        );
        return action === 'publish'
          ? options.service.publish(request.params.campaignId, auditContext(request))
          : options.service.transition(
              request.params.campaignId,
              action === 'close' ? 'CLOSED' : 'ARCHIVED',
              auditContext(request),
            );
      },
    );
  }

  app.get(
    '/api/v1/me/entitlements',
    {
      preHandler: requireSession,
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['entitlements'] },
    },
    (request) => options.service.listForUser(session(request).user.id),
  );

  app.get<{ Params: { campaignId: string } }>(
    '/api/v1/me/campaigns/:campaignId',
    {
      preHandler: requireSession,
      schema: { params: CampaignParameters, response: { 200: Type.Any() }, tags: ['entitlements'] },
    },
    (request) => options.service.getForUser(session(request).user.id, request.params.campaignId),
  );

  app.post<{ Body: { reason: string }; Params: { entitlementId: string } }>(
    '/api/v1/entitlements/:entitlementId/revoke',
    {
      preHandler: requireSession,
      schema: {
        body: Type.Object({ reason: Type.String({ maxLength: 500, minLength: 3 }) }),
        params: EntitlementParameters,
        response: { 200: Type.Any() },
        tags: ['entitlements'],
      },
    },
    async (request) => {
      await options.service.assertEntitlementRevocationAccess(
        session(request),
        request.params.entitlementId,
      );
      return options.service.revoke(
        request.params.entitlementId,
        request.body.reason,
        auditContext(request),
      );
    },
  );

  return Promise.resolve();
};

export default campaignRoutes;
