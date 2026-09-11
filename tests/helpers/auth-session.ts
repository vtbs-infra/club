import { createHash } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';

import type { buildApp } from './test-app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { passwordCredentials, users } from '../../src/server/infrastructure/db/schema/index.js';
import type { CreatorRecord } from '../../src/shared/contracts/creators.js';
import { hashPassword } from '../../src/server/modules/auth/password.js';

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

/** Business fixtures start with an already verified identity; auth tests exercise the public registration flow. */
export async function seedTestUser(input: {
  readonly database: DatabaseService;
  readonly username: string;
  readonly name: string;
  readonly bilibiliUid?: string;
  readonly password?: string;
}): Promise<string> {
  const bilibiliUid =
    input.bilibiliUid ??
    BigInt(
      '0x' + createHash('sha256').update(input.username).digest('hex').slice(0, 12),
    ).toString();
  const passwordHash = await hashPassword(input.password ?? TEST_PASSWORD);
  return input.database.orm.transaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({ username: input.username, name: input.name, bilibiliUid })
      .returning();
    if (!user) throw new Error('User fixture insert returned no row.');
    await transaction.insert(passwordCredentials).values({ userId: user.id, passwordHash });
    return user.id;
  });
}

export async function signInTestUser(input: {
  readonly app: InjectableApp;
  readonly username: string;
  readonly password?: string;
}): Promise<string> {
  const response = await input.app.inject({
    method: 'POST',
    headers: { origin: TEST_ORIGIN },
    payload: { username: input.username, password: input.password ?? TEST_PASSWORD },
    url: '/api/v1/auth/login',
  });
  if (response.statusCode !== 200) {
    throw new Error(
      `Sign-in failed for ${input.username}: ${response.statusCode} ${response.body}`,
    );
  }
  return sessionCookie(response);
}

export async function promoteTestCreator(input: {
  readonly adminCookie: string;
  readonly app: InjectableApp;
  readonly userId: string;
}): Promise<CreatorRecord> {
  const response = await input.app.inject({
    headers: { cookie: input.adminCookie, origin: TEST_ORIGIN },
    method: 'POST',
    payload: {
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
