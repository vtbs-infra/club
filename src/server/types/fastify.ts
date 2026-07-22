import 'fastify';

import type { OrganizationRole } from '../../shared/permissions/permissions.js';
import type { AuthSession } from '../modules/auth/auth.js';

interface OrganizationAccess {
  readonly creatorIds: readonly string[];
  readonly memberId: string;
  readonly organizationId: string;
  readonly role: OrganizationRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    authSession: AuthSession | null;
    organizationAccess: OrganizationAccess | null;
  }
}
