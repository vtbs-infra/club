import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';

import type { AppConfig } from '../../config/env.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { schema } from '../../infrastructure/db/schema/index.js';

export interface CreateAuthOptions {
  readonly config: AppConfig;
  readonly database: DatabaseService;
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    advanced: {
      database: { generateId: 'uuid' },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.config.nodeEnv === 'production',
      },
    },
    appName: 'Club',
    basePath: '/api/auth',
    baseURL: options.config.appUrl,
    database: drizzleAdapter(options.database.orm, {
      provider: 'pg',
      schema,
      usePlural: true,
    }),
    emailAndPassword: {
      autoSignIn: false,
      enabled: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
    },
    secret: options.config.authSecret,
    trustedOrigins: [new URL(options.config.appUrl).origin],
    user: {
      additionalFields: {
        role: {
          defaultValue: 'USER',
          input: false,
          required: true,
          type: ['USER', 'CREATOR', 'PLATFORM_ADMIN'],
        },
      },
    },
  });
}

export type AppAuth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<AppAuth['api']['getSession']>>>;
