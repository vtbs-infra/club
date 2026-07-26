import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireSession } from '../auth/guards.js';
import type { ClaimService } from './claim-service.js';

interface ClaimRoutesOptions {
  readonly auth: AppAuth;
  readonly service: ClaimService;
}

const Id = Type.String({ format: 'uuid' });
const CampaignParameters = Type.Object({ campaignId: Id });
const ClaimParameters = Type.Object({ claimId: Id });
const OrganizationParameters = Type.Object({ orgId: Id });
const IdempotencyHeaders = Type.Object({
  'idempotency-key': Type.String({ maxLength: 128, minLength: 8 }),
});
const OptionValues = Type.Record(Type.String({ maxLength: 40 }), Type.String({ maxLength: 2_000 }));
const SubmitBody = Type.Object(
  {
    addressId: Id,
    optionValues: OptionValues,
    version: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
const VersionBody = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
const CancelBody = Type.Object(
  { reason: Type.String({ maxLength: 500, minLength: 3 }), version: Type.Integer({ minimum: 1 }) },
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

const claimRoutes: FastifyPluginAsync<ClaimRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);

  app.post<{
    Body: { addressId: string; optionValues: Record<string, string>; version?: number };
    Headers: { 'idempotency-key': string };
    Params: { campaignId: string };
  }>(
    '/api/v1/me/campaigns/:campaignId/claim',
    {
      preHandler: requireSession,
      schema: {
        body: SubmitBody,
        headers: IdempotencyHeaders,
        params: CampaignParameters,
        response: { 200: Type.Any() },
        tags: ['claims'],
      },
    },
    (request) =>
      options.service.submit(
        session(request).user.id,
        request.params.campaignId,
        request.body,
        request.headers['idempotency-key'],
        context(request),
      ),
  );

  app.get(
    '/api/v1/me/claims',
    {
      preHandler: requireSession,
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['claims'] },
    },
    (request) => options.service.listForUser(session(request).user.id),
  );

  app.get<{ Params: { claimId: string } }>(
    '/api/v1/me/claims/:claimId',
    {
      preHandler: requireSession,
      schema: { params: ClaimParameters, response: { 200: Type.Any() }, tags: ['claims'] },
    },
    (request) =>
      options.service.getDetailForUser(
        session(request).user.id,
        request.params.claimId,
        context(request),
      ),
  );

  app.patch<{ Body: { addressId: string; version: number }; Params: { claimId: string } }>(
    '/api/v1/me/claims/:claimId/address',
    {
      preHandler: requireSession,
      schema: {
        body: Type.Object({ addressId: Id, version: Type.Integer({ minimum: 1 }) }),
        params: ClaimParameters,
        response: { 200: Type.Any() },
        tags: ['claims'],
      },
    },
    (request) =>
      options.service.updateAddress(
        session(request).user.id,
        request.params.claimId,
        request.body.addressId,
        request.body.version,
        context(request),
      ),
  );

  app.patch<{
    Body: { optionValues: Record<string, string>; version: number };
    Params: { claimId: string };
  }>(
    '/api/v1/me/claims/:claimId/options',
    {
      preHandler: requireSession,
      schema: {
        body: Type.Object({ optionValues: OptionValues, version: Type.Integer({ minimum: 1 }) }),
        params: ClaimParameters,
        response: { 200: Type.Any() },
        tags: ['claims'],
      },
    },
    (request) =>
      options.service.updateOptions(
        session(request).user.id,
        request.params.claimId,
        request.body.optionValues,
        request.body.version,
        context(request),
      ),
  );

  app.post<{ Body: { reason: string; version: number }; Params: { claimId: string } }>(
    '/api/v1/me/claims/:claimId/cancel',
    {
      preHandler: requireSession,
      schema: {
        body: CancelBody,
        params: ClaimParameters,
        response: { 200: Type.Any() },
        tags: ['claims'],
      },
    },
    (request) =>
      options.service.userTransition(
        session(request).user.id,
        request.params.claimId,
        { reason: request.body.reason, target: 'CANCELLED', version: request.body.version },
        context(request),
      ),
  );

  app.post<{ Body: { version: number }; Params: { claimId: string } }>(
    '/api/v1/me/claims/:claimId/confirm-receipt',
    {
      preHandler: requireSession,
      schema: {
        body: VersionBody,
        params: ClaimParameters,
        response: { 200: Type.Any() },
        tags: ['claims'],
      },
    },
    (request) =>
      options.service.userTransition(
        session(request).user.id,
        request.params.claimId,
        { target: 'COMPLETED', version: request.body.version },
        context(request),
      ),
  );

  app.get<{ Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId/claims',
    {
      preHandler: requireSession,
      schema: {
        params: OrganizationParameters,
        response: { 200: Type.Array(Type.Any()) },
        tags: ['claims'],
      },
    },
    async (request) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'claim.read',
      );
      return options.service.listForOrganization(request.params.orgId, access.creatorIds);
    },
  );

  app.post<{
    Body: { claimIds: string[] };
    Headers: { 'idempotency-key': string };
    Params: { orgId: string };
  }>(
    '/api/v1/organizations/:orgId/claims/batch-processing',
    {
      preHandler: requireSession,
      schema: {
        body: Type.Object({ claimIds: Type.Array(Id, { maxItems: 100, minItems: 1 }) }),
        headers: IdempotencyHeaders,
        params: OrganizationParameters,
        response: { 200: Type.Any() },
        tags: ['claims'],
      },
    },
    async (request) => {
      const access = await options.service.assertOrganizationAccess(
        session(request),
        request.params.orgId,
        'claim.process',
      );
      return options.service.batchProcess(
        request.params.orgId,
        request.body.claimIds,
        access.creatorIds,
        request.headers['idempotency-key'],
        context(request),
      );
    },
  );

  const operatorActions = {
    cancel: 'CANCELLED',
    complete: 'COMPLETED',
    'mark-shipped': 'SHIPPED',
    process: 'PROCESSING',
  } as const;
  for (const [action, target] of Object.entries(operatorActions) as [
    keyof typeof operatorActions,
    (typeof operatorActions)[keyof typeof operatorActions],
  ][]) {
    app.post<{
      Body: { reason?: string; version: number };
      Params: { claimId: string };
    }>(
      `/api/v1/claims/:claimId/${action}`,
      {
        preHandler: requireSession,
        schema: {
          body: Type.Object(
            {
              reason: Type.Optional(Type.String({ maxLength: 500, minLength: 3 })),
              version: Type.Integer({ minimum: 1 }),
            },
            { additionalProperties: false },
          ),
          params: ClaimParameters,
          response: { 200: Type.Any() },
          tags: ['claims'],
        },
      },
      async (request) => {
        await options.service.assertClaimAccess(
          session(request),
          request.params.claimId,
          'claim.process',
        );
        return options.service.operatorTransition(
          request.params.claimId,
          { reason: request.body.reason, target, version: request.body.version },
          context(request),
        );
      },
    );
  }

  return Promise.resolve();
};

export default claimRoutes;
