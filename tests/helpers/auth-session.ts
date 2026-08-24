import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';

import type { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { users } from '../../src/server/infrastructure/db/schema/index.js';
import type { CreatorRecord } from '../../src/shared/contracts/creators.js';

export const TEST_ORIGIN = 'http://localhost:3000';
export const TEST_PASSWORD = 'correct-horse-battery-staple';

type InjectableApp = Pick<Awaited<ReturnType<typeof buildApp>>, 'inject'>;

export function sessionCookie(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = values
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('Authentication response did not set a session cookie.');
  return cookie;
}

export async function registerTestUser(input: {
  readonly app: InjectableApp;
  readonly database: DatabaseService;
  readonly email: string;
  readonly name: string;
  readonly password?: string;
}): Promise<string> {
  const response = await input.app.inject({
    method: 'POST',
    payload: {
      email: input.email,
      name: input.name,
      password: input.password ?? TEST_PASSWORD,
    },
    url: '/api/auth/sign-up/email',
  });
  if (response.statusCode !== 200) {
    throw new Error(
      `Registration failed for ${input.email}: ${response.statusCode} ${response.body}`,
    );
  }
  const [user] = await input.database.orm
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (!user) throw new Error(`Registration did not create ${input.email}.`);
  return user.id;
}

export async function signInTestUser(input: {
  readonly app: InjectableApp;
  readonly email: string;
  readonly password?: string;
}): Promise<string> {
  const response = await input.app.inject({
    method: 'POST',
    payload: { email: input.email, password: input.password ?? TEST_PASSWORD },
    url: '/api/auth/sign-in/email',
  });
  if (response.statusCode !== 200) {
    throw new Error(`Sign-in failed for ${input.email}: ${response.statusCode} ${response.body}`);
  }
  return sessionCookie(response);
}

export async function promoteTestCreator(input: {
  readonly adminCookie: string;
  readonly app: InjectableApp;
  readonly suffix: string;
  readonly userId: string;
}): Promise<CreatorRecord> {
  const response = await input.app.inject({
    headers: { cookie: input.adminCookie, origin: TEST_ORIGIN },
    method: 'POST',
    payload: {
      bilibiliUid: `91${input.suffix}`,
      displayName: `Creator ${input.suffix}`,
      roomId: `81${input.suffix}`,
      timezone: 'Asia/Shanghai',
      userId: input.userId,
    },
    url: '/api/v1/admin/creators',
  });
  if (response.statusCode !== 201) {
    throw new Error(`Creator promotion failed: ${response.statusCode} ${response.body}`);
  }
  return response.json<CreatorRecord>();
}
