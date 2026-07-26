import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireSession } from '../auth/guards.js';
import type { AddressService } from './address-service.js';

interface AddressRoutesOptions {
  readonly auth: AppAuth;
  readonly service: AddressService;
}

const Id = Type.String({ format: 'uuid' });
const Parameters = Type.Object({ addressId: Id });
const Payload = Type.Object(
  {
    city: Type.String({ maxLength: 100 }),
    countryRegion: Type.String({ maxLength: 100 }),
    detailedAddress: Type.String({ maxLength: 500 }),
    district: Type.String({ maxLength: 100 }),
    phone: Type.String({ maxLength: 40 }),
    postalCode: Type.String({ maxLength: 20 }),
    province: Type.String({ maxLength: 100 }),
    recipientName: Type.String({ maxLength: 100 }),
    userNote: Type.String({ maxLength: 500 }),
  },
  { additionalProperties: false },
);
const CreateBody = Type.Object(
  {
    isDefault: Type.Boolean(),
    label: Type.String({ maxLength: 80, minLength: 1 }),
    payload: Payload,
  },
  { additionalProperties: false },
);
const UpdateBody = Type.Partial(CreateBody);

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

const addressRoutes: FastifyPluginAsync<AddressRoutesOptions> = (app, options) => {
  const requireSession = createRequireSession(options.auth);

  app.get(
    '/api/v1/me/addresses',
    {
      preHandler: requireSession,
      schema: { response: { 200: Type.Array(Type.Any()) }, tags: ['addresses'] },
    },
    (request) => options.service.list(session(request).user.id, context(request)),
  );

  app.post<{ Body: typeof CreateBody.static }>(
    '/api/v1/me/addresses',
    {
      preHandler: requireSession,
      schema: { body: CreateBody, response: { 201: Type.Any() }, tags: ['addresses'] },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await options.service.create(session(request).user.id, request.body, context(request)),
        ),
  );

  app.patch<{ Body: typeof UpdateBody.static; Params: { addressId: string } }>(
    '/api/v1/me/addresses/:addressId',
    {
      preHandler: requireSession,
      schema: {
        body: UpdateBody,
        params: Parameters,
        response: { 200: Type.Any() },
        tags: ['addresses'],
      },
    },
    (request) =>
      options.service.update(
        session(request).user.id,
        request.params.addressId,
        request.body,
        context(request),
      ),
  );

  app.delete<{ Params: { addressId: string } }>(
    '/api/v1/me/addresses/:addressId',
    {
      preHandler: requireSession,
      schema: { params: Parameters, response: { 204: Type.Null() }, tags: ['addresses'] },
    },
    async (request, reply) => {
      await options.service.delete(
        session(request).user.id,
        request.params.addressId,
        context(request),
      );
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

export default addressRoutes;
