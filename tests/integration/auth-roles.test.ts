import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
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
  registerTestUser,
  signInTestUser,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../helpers/auth-session.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  integration,
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
      auth,
      database,
      email: 'admin@example.com',
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
    const recipientId = await registerTestUser({
      app,
      database,
      email: 'recipient@example.com',
      name: 'Recipient',
    });
    const creatorOneUserId = await registerTestUser({
      app,
      database,
      email: 'creator-one@example.com',
      name: 'Creator Account One',
    });
    const creatorTwoUserId = await registerTestUser({
      app,
      database,
      email: 'creator-two@example.com',
      name: 'Creator Account Two',
    });
    const recipientCookie = await signInTestUser({ app, email: 'recipient@example.com' });
    const adminCookie = await signInTestUser({ app, email: 'admin@example.com' });

    const identity = await app.inject({
      headers: { cookie: recipientCookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(identity.json<Identity>()).toMatchObject({
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

    const creatorOne = await promoteTestCreator({
      adminCookie,
      app,
      suffix: '001',
      userId: creatorOneUserId,
    });
    await promoteTestCreator({
      adminCookie,
      app,
      suffix: '002',
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
        bilibiliUid: '91999',
        displayName: 'Duplicate',
        roomId: '81999',
        timezone: 'Asia/Shanghai',
        userId: creatorOneUserId,
      },
      url: '/api/v1/admin/creators',
    });
    expect(duplicatePromotion.statusCode).toBe(409);

    const creatorOneCookie = await signInTestUser({ app, email: 'creator-one@example.com' });
    const creatorTwoCookie = await signInTestUser({ app, email: 'creator-two@example.com' });
    const creatorIdentity = await app.inject({
      headers: { cookie: creatorOneCookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(creatorIdentity.json<Identity>()).toMatchObject({
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
    expect(ownReleases.json<unknown[]>()).toHaveLength(1);
    expect(otherReleases.json<unknown[]>()).toHaveLength(0);
  });
});
