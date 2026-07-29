import { and, eq } from 'drizzle-orm';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { creators } from '../../infrastructure/db/schema/index.js';
import type { AccountRole } from '../../infrastructure/db/schema/index.js';
import type { AppAuth, AuthSession } from './auth.js';

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

export function createRequireRole(
  auth: AppAuth,
  ...allowedRoles: readonly AccountRole[]
): preHandlerHookHandler {
  return async (request) => {
    const session = await resolveSession(request, auth);
    if (!allowedRoles.includes(session.user.role)) {
      throw new AppError('ROLE_PERMISSION_DENIED', 'This account cannot access this area.', 403);
    }
  };
}

export function createRequirePlatformAdmin(auth: AppAuth): preHandlerHookHandler {
  return createRequireRole(auth, 'PLATFORM_ADMIN');
}

export function createRequireCreator(
  auth: AppAuth,
  database: DatabaseService,
): preHandlerHookHandler {
  return async (request) => {
    const session = await resolveSession(request, auth);
    if (session.user.role !== 'CREATOR') {
      throw new AppError('CREATOR_ACCESS_REQUIRED', 'Creator access required.', 403);
    }
    const [creator] = await database.orm
      .select({
        active: creators.active,
        bilibiliUid: creators.bilibiliUid,
        displayName: creators.displayName,
        id: creators.id,
        roomId: creators.roomId,
        timezone: creators.timezone,
        userId: creators.userId,
      })
      .from(creators)
      .where(and(eq(creators.userId, session.user.id), eq(creators.active, true)))
      .limit(1);
    if (!creator) {
      throw new AppError(
        'CREATOR_PROFILE_UNAVAILABLE',
        'The creator profile is inactive or missing.',
        403,
      );
    }
    request.creatorProfile = creator;
  };
}
