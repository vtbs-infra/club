import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';
import { creators, users } from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth } from '../../src/server/modules/auth/auth.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const origin = 'http://localhost:3000';
const password = 'correct-horse-battery-staple';

interface IdentityResponse {
  readonly creator: { readonly displayName: string; readonly id: string } | null;
  readonly user: { readonly email: string; readonly role: string };
}

interface CreatorResponse {
  readonly id: string;
  readonly userId: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = values
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('Authentication response did not set a session cookie.');
  return cookie;
}

integration('exclusive platform roles and creator ownership', () => {
  let admin: ReturnType<typeof postgres>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseService;
  let databaseName: string;
  let storage: TemporaryStorage;

  beforeAll(async () => {
    const adminUrl = new URL(testDatabaseUrl!);
    adminUrl.pathname = '/postgres';
    admin = postgres(adminUrl.toString(), { max: 1 });
    databaseName = `club_roles_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await admin.unsafe(`create database "${databaseName}"`);
    const databaseUrl = new URL(testDatabaseUrl!);
    databaseUrl.pathname = `/${databaseName}`;
    database = createDatabase(databaseUrl.toString());
    await migrateDatabase(database, resolve('migrations'));
    storage = await createTemporaryStorage();
    const config = createTestConfig({ databaseUrl: databaseUrl.toString() });
    const auth = createAuth({ config, database });
    await bootstrapPlatformAdmin({
      auth,
      database,
      email: 'admin@example.com',
      name: 'Platform Admin',
      password,
    });
    app = await buildApp({
      auth,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
    if (storage) await storage.cleanup();
    if (admin) {
      await admin`
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = ${databaseName} and pid <> pg_backend_pid()
      `;
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end({ timeout: 5 });
    }
  });

  async function register(name: string, email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      payload: { email, name, password },
      url: '/api/auth/sign-up/email',
    });
    expect(response.statusCode, response.body).toBe(200);
    const [user] = await database.orm
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    return user!.id;
  }

  async function signIn(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      payload: { email, password },
      url: '/api/auth/sign-in/email',
    });
    expect(response.statusCode, response.body).toBe(200);
    return cookieFrom(response);
  }

  async function promote(
    adminCookie: string,
    userId: string,
    suffix: string,
  ): Promise<CreatorResponse> {
    const response = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'POST',
      payload: {
        bilibiliUid: `91${suffix}`,
        displayName: `Creator ${suffix}`,
        roomId: `81${suffix}`,
        timezone: 'Asia/Shanghai',
        userId,
      },
      url: '/api/v1/admin/creators',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<CreatorResponse>();
  }

  it('registers recipients, promotes exactly one profile, and scopes creator APIs to the session', async () => {
    const recipientId = await register('Recipient', 'recipient@example.com');
    const creatorOneUserId = await register('Creator Account One', 'creator-one@example.com');
    const creatorTwoUserId = await register('Creator Account Two', 'creator-two@example.com');
    const recipientCookie = await signIn('recipient@example.com');
    const adminCookie = await signIn('admin@example.com');

    const identity = await app.inject({
      headers: { cookie: recipientCookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(identity.json<IdentityResponse>()).toMatchObject({
      creator: null,
      user: { email: 'recipient@example.com', role: 'USER' },
    });
    expect(
      (
        await app.inject({
          headers: { cookie: recipientCookie },
          method: 'GET',
          url: '/api/v1/admin/creators',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: { cookie: recipientCookie },
          method: 'GET',
          url: '/api/v1/creator/releases',
        })
      ).statusCode,
    ).toBe(403);

    const creatorOne = await promote(adminCookie, creatorOneUserId, '001');
    await promote(adminCookie, creatorTwoUserId, '002');
    const [recipient] = await database.orm
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, recipientId));
    const [promoted] = await database.orm
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, creatorOneUserId));
    expect(recipient?.role).toBe('USER');
    expect(promoted?.role).toBe('CREATOR');
    expect(
      (
        await database.orm
          .select({ id: creators.id })
          .from(creators)
          .where(eq(creators.userId, creatorOneUserId))
      ).map((row) => row.id),
    ).toEqual([creatorOne.id]);

    const duplicatePromotion = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'POST',
      payload: {
        bilibiliUid: '91999',
        displayName: 'Duplicate',
        roomId: '81999',
        timezone: 'Asia/Shanghai',
        userId: creatorOneUserId,
      },
      url: '/api/v1/admin/creators',
    });
    expect(duplicatePromotion.statusCode).toBe(409);

    const creatorOneCookie = await signIn('creator-one@example.com');
    const creatorTwoCookie = await signIn('creator-two@example.com');
    const creatorIdentity = await app.inject({
      headers: { cookie: creatorOneCookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(creatorIdentity.json<IdentityResponse>()).toMatchObject({
      creator: { displayName: 'Creator 001', id: creatorOne.id },
      user: { role: 'CREATOR' },
    });
    expect(
      (
        await app.inject({
          headers: { cookie: creatorOneCookie },
          method: 'GET',
          url: '/api/v1/admin/creators',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: { cookie: adminCookie },
          method: 'GET',
          url: '/api/v1/creator/releases',
        })
      ).statusCode,
    ).toBe(403);

    const now = Date.now();
    const created = await app.inject({
      headers: { cookie: creatorOneCookie, origin },
      method: 'POST',
      payload: {
        claimDeadlineAt: new Date(now + 30 * 86_400_000).toISOString(),
        claimStartAt: new Date(now - 86_400_000).toISOString(),
        description: '',
        eligibilityMonth: '2026-08-01',
        formFields: [],
        fulfillmentMode: 'HIGHEST_ONLY',
        packages: [
          {
            description: '',
            items: [{ description: '', name: '纪念徽章', quantity: 1 }],
            name: '八月礼物',
          },
        ],
        tierPackageIndexes: { ADMIRAL: 0, CAPTAIN: 0, GOVERNOR: 0 },
        title: '八月舰长礼物',
      },
      url: '/api/v1/creator/releases',
    });
    expect(created.statusCode, created.body).toBe(201);
    const ownReleases = await app.inject({
      headers: { cookie: creatorOneCookie },
      method: 'GET',
      url: '/api/v1/creator/releases',
    });
    const otherReleases = await app.inject({
      headers: { cookie: creatorTwoCookie },
      method: 'GET',
      url: '/api/v1/creator/releases',
    });
    expect(ownReleases.json<unknown[]>()).toHaveLength(1);
    expect(otherReleases.json<unknown[]>()).toHaveLength(0);
  });
});
