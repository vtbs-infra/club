import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { IdSchema } from '../../../shared/contracts/common.js';
import {
  VerificationRoomInputSchema,
  VerificationRoomSchema,
  VerificationRoomUpdateSchema,
} from '../../../shared/contracts/verification-rooms.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import type { VerificationRoomService } from './verification-room-service.js';

interface VerificationRoomRoutesOptions {
  readonly auth: AppAuth;
  readonly service: VerificationRoomService;
}

interface RoomParameters {
  roomId: string;
}

const RoomParametersSchema = Type.Object({ roomId: IdSchema });

function auditContext(request: {
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

const verificationRoomRoutes: FastifyPluginAsync<VerificationRoomRoutesOptions> = (
  app,
  options,
) => {
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/admin/verification-rooms',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        response: { 200: Type.Array(VerificationRoomSchema) },
        tags: ['verification-rooms'],
      },
    },
    async () => options.service.list(),
  );

  app.post<{ Body: typeof VerificationRoomInputSchema.static }>(
    '/api/v1/admin/verification-rooms',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: VerificationRoomInputSchema,
        response: { 201: VerificationRoomSchema },
        tags: ['verification-rooms'],
      },
    },
    async (request, reply) => {
      const room = await options.service.create({
        ...auditContext(request),
        biliRoomId: request.body.biliRoomId,
        displayName: request.body.displayName,
        enabled: request.body.enabled ?? true,
        priority: request.body.priority ?? 100,
      });
      return reply.status(201).send(room);
    },
  );

  app.patch<{ Body: typeof VerificationRoomUpdateSchema.static; Params: RoomParameters }>(
    '/api/v1/admin/verification-rooms/:roomId',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: VerificationRoomUpdateSchema,
        params: RoomParametersSchema,
        response: { 200: VerificationRoomSchema },
        tags: ['verification-rooms'],
      },
    },
    async (request) =>
      options.service.update({
        ...auditContext(request),
        ...request.body,
        roomId: request.params.roomId,
      }),
  );

  app.post<{ Body: Record<string, never>; Params: RoomParameters }>(
    '/api/v1/admin/verification-rooms/:roomId/test',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        params: RoomParametersSchema,
        response: { 200: VerificationRoomSchema },
        tags: ['verification-rooms'],
      },
    },
    async (request) =>
      options.service.test({
        ...auditContext(request),
        roomId: request.params.roomId,
      }),
  );

  return Promise.resolve();
};

export default verificationRoomRoutes;
