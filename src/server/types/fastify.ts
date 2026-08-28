import 'fastify';

import type { AuthSession } from '../modules/auth/auth.js';

interface CreatorProfile {
  readonly id: string;
  readonly userId: string;
  readonly bilibiliUid: string;
  readonly roomId: string;
  readonly displayName: string;
  readonly timezone: string;
  readonly monthlySyncEnabled: boolean;
  readonly profileSyncedAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    authSession: AuthSession | null;
    creatorProfile: CreatorProfile | null;
  }
}
