import { eq, sql } from 'drizzle-orm';
import { describe as integration, afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/test-app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { auditLogs, platformAppearance } from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth, type AppAuth } from '../../src/server/modules/auth/auth.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import type { Appearance } from '../../src/shared/contracts/appearance.js';
import { seedTestUser, signInTestUser, TEST_ORIGIN } from '../helpers/auth-session.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';

integration('platform appearance', () => {
  let adminCookie: string;
  let adminId: string;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let auth: AppAuth;
  let creatorCookie: string;
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let storage: TemporaryStorage;
  let userCookie: string;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('appearance');
    database = integrationDatabase.database;
    storage = await createTemporaryStorage();
    const config = createTestConfig({ databaseUrl: integrationDatabase.databaseUrl });
    auth = createAuth({ config, database });
    adminId = await seedTestUser({
      database,
      username: 'admin',
      name: 'Platform Admin',
      role: 'PLATFORM_ADMIN',
    });
    app = await buildTestApp({
      auth,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });

    await seedTestUser({
      database,
      username: 'recipient',
      name: 'Recipient',
    });
    const creatorUserId = await seedTestUser({
      database,
      username: 'creator',
      name: 'Creator',
      bilibiliUid: '90001',
      role: 'CREATOR',
    });
    adminCookie = await signInTestUser({ app, username: 'admin' });
    await insertTestCreator(database, {
      userId: creatorUserId,
      bilibiliUid: '90001',
      roomId: '80001',
      displayName: 'Creator',
    });
    userCookie = await signInTestUser({ app, username: 'recipient' });
    creatorCookie = await signInTestUser({ app, username: 'creator' });
  });

  beforeEach(async () => {
    await database.orm.execute(sql`truncate audit_logs`);
    await database.orm.update(platformAppearance).set({
      themePreset: 'moe',
      updatedByUserId: null,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (storage) await storage.cleanup();
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('exposes appearance publicly and restricts updates to platform administrators', async () => {
    const current = await app.inject({ method: 'GET', url: '/api/v1/appearance' });
    expect(current.statusCode, current.body).toBe(200);
    expect(current.json<Appearance>()).toEqual({ themePreset: 'moe' });
    expect(current.headers['cache-control']).toBe('no-store');
    for (const cookie of [userCookie, creatorCookie]) {
      const forbidden = await app.inject({
        headers: { cookie, origin: TEST_ORIGIN },
        method: 'PUT',
        payload: { themePreset: 'neon' },
        url: '/api/v1/admin/appearance',
      });
      expect(forbidden.statusCode).toBe(403);
    }

    const anonymous = await app.inject({
      headers: { origin: TEST_ORIGIN },
      method: 'PUT',
      payload: { themePreset: 'neon' },
      url: '/api/v1/admin/appearance',
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('persists an admin change and audits it once even when the same selection is saved again', async () => {
    const save = () =>
      app.inject({
        headers: { cookie: adminCookie, origin: TEST_ORIGIN },
        method: 'PUT',
        payload: { themePreset: 'neon' },
        url: '/api/v1/admin/appearance',
      });
    const response = await save();
    expect(response.statusCode, response.body).toBe(200);
    const [saved] = await database.orm.select().from(platformAppearance);
    expect(saved?.themePreset).toBe('neon');

    expect((await save()).statusCode).toBe(200);
    expect(await database.orm.select().from(platformAppearance)).toEqual([saved]);
    expect(
      await database.orm
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'platform-appearance.updated')),
    ).toMatchObject([
      {
        actorUserId: adminId,
        afterSummary: { themePreset: 'neon' },
        beforeSummary: { themePreset: 'moe' },
      },
    ]);

    await app.close();
    app = await buildTestApp({
      config: createTestConfig({ databaseUrl: integrationDatabase.databaseUrl }),
      database,
      startBackground: false,
      storage: storage.driver,
    });
    const current = await app.inject({ method: 'GET', url: '/api/v1/appearance' });
    expect(current.json<Appearance>()).toEqual({ themePreset: 'neon' });
  });

  it('enforces singleton and preset constraints in PostgreSQL', async () => {
    await expect(
      database.orm.execute(sql`
        insert into platform_appearance (id, theme_preset)
        values ('another', 'moe')
      `),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      database.orm.execute(sql`
        update platform_appearance
        set theme_preset = 'custom'
        where id = 'global'
      `),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });
});
