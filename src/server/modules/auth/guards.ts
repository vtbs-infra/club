import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { AppError } from '../../../shared/errors/app-error.js';
import {
  hasOrganizationPermission,
  isOrganizationRole,
  type OrganizationPermission,
} from '../../../shared/permissions/permissions.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  memberCreatorScopes,
  organizationMembers,
  organizations,
} from '../../infrastructure/db/schema.js';
import type { AppAuth, AuthSession } from './auth.js';
import { fromNodeHeaders } from 'better-auth/node';

export async function resolveSession(request: FastifyRequest, auth: AppAuth): Promise<AuthSession> {
  if (request.authSession) return request.authSession;
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    throw new AppError('AUTHENTICATION_REQUIRED', 'Sign in is required.', 401);
  }
  request.authSession = session;
  return session;
}

export function createRequireSession(auth: AppAuth): preHandlerHookHandler {
  return async (request) => {
    await resolveSession(request, auth);
  };
}

export function createRequirePlatformAdmin(auth: AppAuth): preHandlerHookHandler {
  return async (request) => {
    const session = await resolveSession(request, auth);
    if (session.user.platformRole !== 'PLATFORM_ADMIN') {
      throw new AppError(
        'PLATFORM_PERMISSION_DENIED',
        'Platform administrator access required.',
        403,
      );
    }
  };
}

export function createRequireOrganizationPermission(
  auth: AppAuth,
  database: DatabaseService,
  permission: OrganizationPermission,
): preHandlerHookHandler {
  return async (request) => {
    const session = await resolveSession(request, auth);
    const parameters = request.params as { creatorId?: string; orgId?: string };
    const organizationId = parameters.orgId;
    if (!organizationId) {
      throw new AppError('ORGANIZATION_SCOPE_REQUIRED', 'An organization scope is required.', 400);
    }

    const [membership] = await database.orm
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, session.user.id),
          isNull(organizations.archivedAt),
        ),
      )
      .limit(1);

    if (!membership || !isOrganizationRole(membership.role)) {
      throw new AppError('ORGANIZATION_ACCESS_DENIED', 'Organization access denied.', 403);
    }
    if (!hasOrganizationPermission(membership.role, permission)) {
      throw new AppError('ORGANIZATION_PERMISSION_DENIED', 'Organization permission denied.', 403);
    }

    const scopes = await database.orm
      .select({ creatorId: memberCreatorScopes.creatorId })
      .from(memberCreatorScopes)
      .where(eq(memberCreatorScopes.memberId, membership.id));
    const creatorIds = scopes.map((scope) => scope.creatorId);
    if (
      parameters.creatorId &&
      creatorIds.length > 0 &&
      !creatorIds.includes(parameters.creatorId)
    ) {
      throw new AppError('CREATOR_SCOPE_DENIED', 'Creator access denied.', 403);
    }

    request.organizationAccess = {
      creatorIds,
      memberId: membership.id,
      organizationId,
      role: membership.role,
    };
  };
}
