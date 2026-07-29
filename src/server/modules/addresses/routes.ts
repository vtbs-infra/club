import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import {
  AddressInputSchema,
  AddressRecordSchema,
  AddressUpdateSchema,
} from '../../../shared/contracts/addresses.js';
import { IdSchema } from '../../../shared/contracts/common.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequireSession } from '../auth/guards.js';
import type { AddressService } from './address-service.js';

interface AddressRoutesOptions {
  readonly auth: AppAuth;
  readonly service: AddressService;
}

const Parameters = Type.Object({ addressId: IdSchema });

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
      schema: { response: { 200: Type.Array(AddressRecordSchema) }, tags: ['addresses'] },
    },
    (request) => options.service.list(session(request).user.id),
  );

  app.post<{ Body: typeof AddressInputSchema.static }>(
    '/api/v1/me/addresses',
    {
      preHandler: requireSession,
      schema: {
        body: AddressInputSchema,
        response: { 201: AddressRecordSchema },
        tags: ['addresses'],
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await options.service.create(session(request).user.id, request.body, context(request)),
        ),
  );

  app.patch<{ Body: typeof AddressUpdateSchema.static; Params: { addressId: string } }>(
    '/api/v1/me/addresses/:addressId',
    {
      preHandler: requireSession,
      schema: {
        body: AddressUpdateSchema,
        params: Parameters,
        response: { 200: AddressRecordSchema },
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
