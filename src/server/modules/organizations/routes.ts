import { eq, inArray } from 'drizzle-orm';
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import {
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from '../../../shared/permissions/permissions.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  memberCreatorScopes,
  organizationMembers,
  organizations,
} from '../../infrastructure/db/schema.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import {
  createRequireOrganizationPermission,
  createRequirePlatformAdmin,
  createRequireSession,
} from '../auth/guards.js';
import { OrganizationService } from './organization-service.js';

interface OrganizationRoutesOptions {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
}

interface OrganizationParameters {
  orgId: string;
}

interface MemberParameters extends OrganizationParameters {
  memberId: string;
}

interface CreatorParameters extends OrganizationParameters {
  creatorId: string;
}

interface CreateOrganizationBody {
  name: string;
  ownerUserId: string;
  slug: string;
}

interface UpdateOrganizationBody {
  name: string;
}

interface CreateMemberBody {
  creatorIds?: string[];
  role: OrganizationRole;
  userId: string;
}

interface UpdateMemberBody {
  creatorIds?: string[];
  role?: OrganizationRole;
}

interface CreateCreatorBody {
  active?: boolean;
  bilibiliUid: string;
  displayName: string;
  roomId: string;
  timezone: string;
}

interface UpdateCreatorBody {
  active?: boolean;
  bilibiliUid?: string;
  displayName?: string;
  roomId?: string;
  timezone?: string;
}

const IdSchema = Type.String({ format: 'uuid' });
const OrganizationRoleSchema = Type.Union(ORGANIZATION_ROLES.map((role) => Type.Literal(role)));
const OrganizationSchema = Type.Object({
  archivedAt: Type.Union([Type.Null(), Type.String({ format: 'date-time' })]),
  id: IdSchema,
  name: Type.String(),
  slug: Type.String(),
});
const CreatorSchema = Type.Object({
  active: Type.Boolean(),
  archivedAt: Type.Union([Type.Null(), Type.String({ format: 'date-time' })]),
  bilibiliUid: Type.String(),
  displayName: Type.String(),
  id: IdSchema,
  organizationId: IdSchema,
  roomId: Type.String(),
  timezone: Type.String(),
});
const MemberSchema = Type.Object({
  creatorIds: Type.Array(IdSchema),
  email: Type.Optional(Type.String({ format: 'email' })),
  id: IdSchema,
  name: Type.Optional(Type.String()),
  organizationId: Type.Optional(IdSchema),
  role: OrganizationRoleSchema,
  userId: IdSchema,
});
const OrganizationParametersSchema = Type.Object({ orgId: IdSchema });
const MemberParametersSchema = Type.Object({ memberId: IdSchema, orgId: IdSchema });
const CreatorParametersSchema = Type.Object({ creatorId: IdSchema, orgId: IdSchema });

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

const organizationRoutes: FastifyPluginAsync<OrganizationRoutesOptions> = (app, options) => {
  const service = new OrganizationService(options.database);
  const requireSession = createRequireSession(options.auth);
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/me',
    {
      preHandler: requireSession,
      schema: {
        response: {
          200: Type.Object({
            memberships: Type.Array(
              Type.Object({
                creatorIds: Type.Array(IdSchema),
                id: IdSchema,
                organization: Type.Object({
                  id: IdSchema,
                  name: Type.String(),
                  slug: Type.String(),
                }),
                role: OrganizationRoleSchema,
              }),
            ),
            user: Type.Object({
              email: Type.String({ format: 'email' }),
              id: IdSchema,
              name: Type.String(),
              platformRole: Type.Union([Type.Literal('USER'), Type.Literal('PLATFORM_ADMIN')]),
            }),
          }),
        },
        tags: ['identity'],
      },
    },
    async (request) => {
      const session = request.authSession!;
      const memberships = await options.database.orm
        .select({
          id: organizationMembers.id,
          organizationId: organizations.id,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, session.user.id));
      const scopes =
        memberships.length === 0
          ? []
          : await options.database.orm
              .select({
                creatorId: memberCreatorScopes.creatorId,
                memberId: memberCreatorScopes.memberId,
              })
              .from(memberCreatorScopes)
              .where(
                inArray(
                  memberCreatorScopes.memberId,
                  memberships.map((membership) => membership.id),
                ),
              );
      return {
        memberships: memberships.map((membership) => ({
          creatorIds: scopes
            .filter((scope) => scope.memberId === membership.id)
            .map((scope) => scope.creatorId),
          id: membership.id,
          organization: {
            id: membership.organizationId,
            name: membership.organizationName,
            slug: membership.organizationSlug,
          },
          role: membership.role,
        })),
        user: {
          email: session.user.email,
          id: session.user.id,
          name: session.user.name,
          platformRole: session.user.platformRole,
        },
      };
    },
  );

  app.get(
    '/api/v1/platform/organizations',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        response: { 200: Type.Array(OrganizationSchema) },
        tags: ['platform'],
      },
    },
    async () => service.listPlatformOrganizations(),
  );

  app.post<{ Body: CreateOrganizationBody }>(
    '/api/v1/platform/organizations',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: Type.Object({
          name: Type.String({ maxLength: 120, minLength: 1 }),
          ownerUserId: IdSchema,
          slug: Type.String({ maxLength: 80, minLength: 2, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
        }),
        response: { 201: OrganizationSchema },
        tags: ['platform'],
      },
    },
    async (request, reply) => {
      const organization = await service.createOrganization({
        ...request.body,
        ...auditContext(request),
      });
      return reply.status(201).send(organization);
    },
  );

  app.get<{ Params: OrganizationParameters }>(
    '/api/v1/organizations/:orgId',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'organization.read',
      ),
      schema: {
        params: OrganizationParametersSchema,
        response: { 200: OrganizationSchema },
        tags: ['organizations'],
      },
    },
    async (request) => service.getOrganization(request.params.orgId),
  );

  app.patch<{ Body: UpdateOrganizationBody; Params: OrganizationParameters }>(
    '/api/v1/organizations/:orgId',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'organization.update',
      ),
      schema: {
        body: Type.Object({ name: Type.String({ maxLength: 120, minLength: 1 }) }),
        params: OrganizationParametersSchema,
        response: { 200: OrganizationSchema },
        tags: ['organizations'],
      },
    },
    async (request) =>
      service.updateOrganization({
        ...auditContext(request),
        name: request.body.name,
        organizationId: request.params.orgId,
      }),
  );

  app.get<{ Params: OrganizationParameters }>(
    '/api/v1/organizations/:orgId/members',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'member.read',
      ),
      schema: {
        params: OrganizationParametersSchema,
        response: { 200: Type.Array(MemberSchema) },
        tags: ['organization-members'],
      },
    },
    async (request) => service.listMembers(request.params.orgId),
  );

  app.post<{ Body: CreateMemberBody; Params: OrganizationParameters }>(
    '/api/v1/organizations/:orgId/members',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'member.manage',
      ),
      schema: {
        body: Type.Object({
          creatorIds: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
          role: OrganizationRoleSchema,
          userId: IdSchema,
        }),
        params: OrganizationParametersSchema,
        response: { 201: MemberSchema },
        tags: ['organization-members'],
      },
    },
    async (request, reply) => {
      const membership = await service.addMember({
        ...auditContext(request),
        creatorIds: request.body.creatorIds ?? [],
        organizationId: request.params.orgId,
        role: request.body.role,
        userId: request.body.userId,
      });
      return reply.status(201).send(membership);
    },
  );

  app.patch<{ Body: UpdateMemberBody; Params: MemberParameters }>(
    '/api/v1/organizations/:orgId/members/:memberId',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'member.manage',
      ),
      schema: {
        body: Type.Object(
          {
            creatorIds: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
            role: Type.Optional(OrganizationRoleSchema),
          },
          { minProperties: 1 },
        ),
        params: MemberParametersSchema,
        response: { 200: MemberSchema },
        tags: ['organization-members'],
      },
    },
    async (request) =>
      service.updateMember({
        ...auditContext(request),
        ...(request.body.creatorIds ? { creatorIds: request.body.creatorIds } : {}),
        memberId: request.params.memberId,
        organizationId: request.params.orgId,
        ...(request.body.role ? { role: request.body.role } : {}),
      }),
  );

  app.delete<{ Params: MemberParameters }>(
    '/api/v1/organizations/:orgId/members/:memberId',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'member.manage',
      ),
      schema: {
        params: MemberParametersSchema,
        response: { 204: Type.Null() },
        tags: ['organization-members'],
      },
    },
    async (request, reply) => {
      await service.removeMember({
        ...auditContext(request),
        memberId: request.params.memberId,
        organizationId: request.params.orgId,
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Params: OrganizationParameters }>(
    '/api/v1/organizations/:orgId/creators',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'creator.read',
      ),
      schema: {
        params: OrganizationParametersSchema,
        response: { 200: Type.Array(CreatorSchema) },
        tags: ['creators'],
      },
    },
    async (request) =>
      service.listCreators(request.params.orgId, request.organizationAccess?.creatorIds),
  );

  app.post<{ Body: CreateCreatorBody; Params: OrganizationParameters }>(
    '/api/v1/organizations/:orgId/creators',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'creator.manage',
      ),
      schema: {
        body: Type.Object({
          active: Type.Optional(Type.Boolean({ default: true })),
          bilibiliUid: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
          displayName: Type.String({ maxLength: 120, minLength: 1 }),
          roomId: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
          timezone: Type.String({ maxLength: 100, minLength: 1 }),
        }),
        params: OrganizationParametersSchema,
        response: { 201: CreatorSchema },
        tags: ['creators'],
      },
    },
    async (request, reply) => {
      const creator = await service.createCreator({
        ...auditContext(request),
        active: request.body.active ?? true,
        bilibiliUid: request.body.bilibiliUid,
        displayName: request.body.displayName,
        organizationId: request.params.orgId,
        roomId: request.body.roomId,
        timezone: request.body.timezone,
      });
      return reply.status(201).send(creator);
    },
  );

  app.patch<{ Body: UpdateCreatorBody; Params: CreatorParameters }>(
    '/api/v1/organizations/:orgId/creators/:creatorId',
    {
      preHandler: createRequireOrganizationPermission(
        options.auth,
        options.database,
        'creator.manage',
      ),
      schema: {
        body: Type.Object(
          {
            active: Type.Optional(Type.Boolean()),
            bilibiliUid: Type.Optional(
              Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
            ),
            displayName: Type.Optional(Type.String({ maxLength: 120, minLength: 1 })),
            roomId: Type.Optional(
              Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
            ),
            timezone: Type.Optional(Type.String({ maxLength: 100, minLength: 1 })),
          },
          { minProperties: 1 },
        ),
        params: CreatorParametersSchema,
        response: { 200: CreatorSchema },
        tags: ['creators'],
      },
    },
    async (request) =>
      service.updateCreator({
        ...auditContext(request),
        ...request.body,
        creatorId: request.params.creatorId,
        organizationId: request.params.orgId,
      }),
  );
  return Promise.resolve();
};

export default organizationRoutes;
