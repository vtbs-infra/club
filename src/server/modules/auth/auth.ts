import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';

import type { AppConfig } from '../../config/env.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { schema } from '../../infrastructure/db/schema.js';
import {
  createAuthEmailSender,
  type AuthEmailSender,
} from '../../infrastructure/email/email-sender.js';

export interface CreateAuthOptions {
  readonly config: AppConfig;
  readonly database: DatabaseService;
  readonly emailSender?: AuthEmailSender | null;
}

export function createAuth(options: CreateAuthOptions) {
  const emailSender = options.emailSender ?? createAuthEmailSender(options.config);
  const emailAndPassword = emailSender
    ? {
        autoSignIn: false,
        enabled: true as const,
        requireEmailVerification: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) =>
          emailSender.sendPasswordReset({ email: user.email, url }),
      }
    : {
        autoSignIn: false,
        enabled: true as const,
        requireEmailVerification: false,
        revokeSessionsOnPasswordReset: true,
      };

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
    emailAndPassword,
    ...(emailSender
      ? {
          emailVerification: {
            autoSignInAfterVerification: true,
            sendOnSignUp: true,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => emailSender.sendVerification({ email: user.email, url }),
          },
        }
      : {}),
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
