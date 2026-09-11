import { eq } from 'drizzle-orm';
import { describe as integration, afterAll, beforeAll, expect, it } from 'vitest';

import { buildApp } from '../helpers/test-app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { creators, users } from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth } from '../../src/server/modules/auth/auth.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import type { Identity } from '../../src/shared/contracts/creators.js';
import {
  promoteTestCreator,
  seedTestUser,
  signInTestUser,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../helpers/auth-session.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';

integration('exclusive platform roles and creator ownership', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let storage: TemporaryStorage;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('roles');
    database = integrationDatabase.database;
    storage = await createTemporaryStorage();
    const config = createTestConfig({ databaseUrl: integrationDatabase.databaseUrl });
    const auth = createAuth({ config, database });
    await bootstrapPlatformAdmin({
      database,
      username: 'admin',
      name: 'Platform Admin',
      password: TEST_PASSWORD,
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
    if (storage) await storage.cleanup();
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('promotes one creator profile and scopes creator APIs to its session', async () => {
    const recipientId = await seedTestUser({
      database,
      username: 'recipient',
      name: 'Recipient',
    });
    const creatorOneUserId = await seedTestUser({
      database,
      username: 'creator_one',
      bilibiliUid: '91001',
      name: 'Creator Account One',
    });
    const creatorTwoUserId = await seedTestUser({
      database,
      username: 'creator_two',
      bilibiliUid: '91002',
      name: 'Creator Account Two',
    });
    const recipientCookie = await signInTestUser({ app, username: 'recipient' });
    const adminCookie = await signInTestUser({ app, username: 'admin' });

    const identity = await app.inject({
      headers: { cookie: recipientCookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(identity.json<Identity>()).toMatchObject({
      creator: null,
      user: { username: 'recipient', role: 'USER' },
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

    const creatorOne = await promoteTestCreator({
      adminCookie,
      app,
      userId: creatorOneUserId,
    });
    await promoteTestCreator({
      adminCookie,
      app,
      userId: creatorTwoUserId,
    });
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
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {
        timezone: 'Asia/Shanghai',
        userId: creatorOneUserId,
      },
      url: '/api/v1/admin/creators',
    });
    expect(duplicatePromotion.statusCode).toBe(409);

    const creatorOneCookie = await signInTestUser({ app, username: 'creator_one' });
    const creatorTwoCookie = await signInTestUser({ app, username: 'creator_two' });
    const creatorIdentity = await app.inject({
      headers: { cookie: creatorOneCookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(creatorIdentity.json<Identity>()).toMatchObject({
      creator: {
        displayName: 'Creator 91001',
        id: creatorOne.id,
        monthlySyncEnabled: true,
      },
      user: { role: 'CREATOR' },
    });
    expect(
      (
        await app.inject({
          headers: { cookie: creatorOneCookie },
          method: 'GET',
          url: '/api/v1/me/gifts',
        })
      ).statusCode,
    ).toBe(200);
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

    const created = await app.inject({
      headers: { cookie: creatorOneCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: createReleaseDraft('2026-08-01'),
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
    expect(ownReleases.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(otherReleases.json<{ items: unknown[] }>().items).toHaveLength(0);
  });
});
