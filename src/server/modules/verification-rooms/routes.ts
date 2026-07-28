import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

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

interface CreateRoomBody {
  biliOwnerUid: string;
  biliRoomId: string;
  displayName: string;
  enabled?: boolean;
  priority?: number;
}

interface UpdateRoomBody {
  biliOwnerUid?: string;
  displayName?: string;
  enabled?: boolean;
  priority?: number;
}

const IdSchema = Type.String({ format: 'uuid' });
const HealthSchema = Type.Union([
  Type.Literal('UNKNOWN'),
  Type.Literal('CONNECTING'),
  Type.Literal('HEALTHY'),
  Type.Literal('UNHEALTHY'),
]);
const RoomSchema = Type.Object({
  biliOwnerUid: Type.String(),
  biliRoomId: Type.String(),
  displayName: Type.String(),
  enabled: Type.Boolean(),
  healthStatus: HealthSchema,
  id: IdSchema,
  lastConnectedAt: Type.Union([Type.Null(), Type.String({ format: 'date-time' })]),
  priority: Type.Integer(),
});
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
      schema: { response: { 200: Type.Array(RoomSchema) }, tags: ['verification-rooms'] },
    },
    async () => options.service.list(),
  );

  app.post<{ Body: CreateRoomBody }>(
    '/api/v1/admin/verification-rooms',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: Type.Object({
          biliOwnerUid: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
          biliRoomId: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
          displayName: Type.String({ maxLength: 120, minLength: 1 }),
          enabled: Type.Optional(Type.Boolean({ default: true })),
          priority: Type.Optional(Type.Integer({ default: 100, maximum: 10_000, minimum: 0 })),
        }),
        response: { 201: RoomSchema },
        tags: ['verification-rooms'],
      },
    },
    async (request, reply) => {
      const room = await options.service.create({
        ...auditContext(request),
        biliOwnerUid: request.body.biliOwnerUid,
        biliRoomId: request.body.biliRoomId,
        displayName: request.body.displayName,
        enabled: request.body.enabled ?? true,
        priority: request.body.priority ?? 100,
      });
      return reply.status(201).send(room);
    },
  );

  app.patch<{ Body: UpdateRoomBody; Params: RoomParameters }>(
    '/api/v1/admin/verification-rooms/:roomId',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: Type.Object(
          {
            biliOwnerUid: Type.Optional(
              Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
            ),
            displayName: Type.Optional(Type.String({ maxLength: 120, minLength: 1 })),
            enabled: Type.Optional(Type.Boolean()),
            priority: Type.Optional(Type.Integer({ maximum: 10_000, minimum: 0 })),
          },
          { minProperties: 1 },
        ),
        params: RoomParametersSchema,
        response: { 200: RoomSchema },
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
        response: { 200: RoomSchema },
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
