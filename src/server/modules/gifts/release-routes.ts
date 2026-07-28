import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireCreator } from '../auth/guards.js';
import type { GiftReleaseService } from './release-service.js';

interface GiftReleaseRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly service: GiftReleaseService;
}

const Id = Type.String({ format: 'uuid' });
const FieldType = Type.Union([
  Type.Literal('TEXT'),
  Type.Literal('TEXTAREA'),
  Type.Literal('SELECT'),
  Type.Literal('RADIO'),
  Type.Literal('CHECKBOX'),
]);
const ReleaseBody = Type.Object(
  {
    claimDeadlineAt: Type.String({ format: 'date-time' }),
    claimStartAt: Type.String({ format: 'date-time' }),
    description: Type.String({ maxLength: 5_000 }),
    eligibilityMonth: Type.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])-01$' }),
    formFields: Type.Array(
      Type.Object(
        {
          key: Type.String({ maxLength: 40, minLength: 1 }),
          label: Type.String({ maxLength: 120, minLength: 1 }),
          options: Type.Optional(
            Type.Array(Type.String({ maxLength: 120, minLength: 1 }), { maxItems: 30 }),
          ),
          required: Type.Boolean(),
          type: FieldType,
        },
        { additionalProperties: false },
      ),
      { maxItems: 20 },
    ),
    fulfillmentMode: Type.Union([Type.Literal('HIGHEST_ONLY'), Type.Literal('CUMULATIVE')]),
    packages: Type.Array(
      Type.Object(
        {
          description: Type.String({ maxLength: 2_000 }),
          items: Type.Array(
            Type.Object(
              {
                description: Type.String({ maxLength: 1_000 }),
                name: Type.String({ maxLength: 120, minLength: 1 }),
                quantity: Type.Integer({ maximum: 999, minimum: 1 }),
              },
              { additionalProperties: false },
            ),
            { maxItems: 30 },
          ),
          name: Type.String({ maxLength: 120, minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 12, minItems: 1 },
    ),
    tierPackageIndexes: Type.Object(
      {
        ADMIRAL: Type.Integer({ minimum: 0 }),
        CAPTAIN: Type.Integer({ minimum: 0 }),
        GOVERNOR: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    title: Type.String({ maxLength: 160, minLength: 1 }),
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

const giftReleaseRoutes: FastifyPluginAsync<GiftReleaseRoutesOptions> = (app, options) => {
  const requireCreator = createRequireCreator(options.auth, options.database);
  const parameters = Type.Object({ releaseId: Id });

  app.get(
    '/api/v1/creator/releases',
    {
      preHandler: requireCreator,
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['creator-gifts'] },
    },
    (request) => options.service.list(request.creatorProfile!.id),
  );

  app.post<{ Body: typeof ReleaseBody.static }>(
    '/api/v1/creator/releases',
    {
      preHandler: requireCreator,
      schema: {
        body: ReleaseBody,
        response: { 201: Type.Any() },
        tags: ['creator-gifts'],
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await options.service.create(request.creatorProfile!.id, request.body, context(request)),
        ),
  );

  app.get<{ Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId',
    {
      preHandler: requireCreator,
      schema: {
        params: parameters,
        response: { 200: Type.Any() },
        tags: ['creator-gifts'],
      },
    },
    (request) => options.service.get(request.creatorProfile!.id, request.params.releaseId),
  );

  app.put<{ Body: typeof ReleaseBody.static; Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId',
    {
      preHandler: requireCreator,
      schema: {
        body: ReleaseBody,
        params: parameters,
        response: { 200: Type.Any() },
        tags: ['creator-gifts'],
      },
    },
    (request) =>
      options.service.update(
        request.creatorProfile!.id,
        request.params.releaseId,
        request.body,
        context(request),
      ),
  );

  app.post<{ Body: Record<string, never>; Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId/publish',
    {
      preHandler: requireCreator,
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        params: parameters,
        response: { 200: Type.Any() },
        tags: ['creator-gifts'],
      },
    },
    (request) =>
      options.service.publish(
        request.creatorProfile!.id,
        request.params.releaseId,
        context(request),
      ),
  );

  app.post<{ Body: Record<string, never>; Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId/close',
    {
      preHandler: requireCreator,
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        params: parameters,
        response: { 200: Type.Any() },
        tags: ['creator-gifts'],
      },
    },
    (request) =>
      options.service.close(request.creatorProfile!.id, request.params.releaseId, context(request)),
  );

  app.delete<{ Params: { releaseId: string } }>(
    '/api/v1/creator/releases/:releaseId',
    {
      preHandler: requireCreator,
      schema: {
        params: parameters,
        response: { 204: Type.Null() },
        tags: ['creator-gifts'],
      },
    },
    async (request, reply) => {
      await options.service.removeDraft(
        request.creatorProfile!.id,
        request.params.releaseId,
        context(request),
      );
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

export default giftReleaseRoutes;
