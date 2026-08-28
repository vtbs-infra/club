import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { auditLogs, platformAppearance } from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth, type AppAuth } from '../../src/server/modules/auth/auth.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import type { Appearance, ThemePreset } from '../../src/shared/contracts/appearance.js';
import {
  promoteTestCreator,
  registerTestUser,
  signInTestUser,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../helpers/auth-session.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';

integration('platform appearance', () => {
  let adminCookie: string;
  let adminId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
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
    const admin = await bootstrapPlatformAdmin({
      auth,
      database,
      email: 'admin@example.com',
      name: 'Platform Admin',
      password: TEST_PASSWORD,
    });
    adminId = admin.id;
    app = await buildApp({
      auth,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });

    await registerTestUser({
      app,
      database,
      email: 'recipient@example.com',
      name: 'Recipient',
    });
    const creatorUserId = await registerTestUser({
      app,
      database,
      email: 'creator@example.com',
      name: 'Creator',
    });
    adminCookie = await signInTestUser({ app, email: 'admin@example.com' });
    await promoteTestCreator({
      adminCookie,
      app,
      database,
      suffix: '003',
      userId: creatorUserId,
    });
    userCookie = await signInTestUser({ app, email: 'recipient@example.com' });
    creatorCookie = await signInTestUser({ app, email: 'creator@example.com' });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (storage) await storage.cleanup();
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('exposes the seeded Moe preset publicly and restricts updates to platform administrators', async () => {
    const current = await app.inject({ method: 'GET', url: '/api/v1/appearance' });
    expect(current.statusCode, current.body).toBe(200);
    expect(current.json<Appearance>()).toEqual({ themePreset: 'moe' });
    expect(current.headers['cache-control']).toBe('no-store');
    const openapi = await app.inject({ method: 'GET', url: '/openapi.json' });
    const paths = openapi.json<{ paths: Record<string, unknown> }>().paths;
    expect(paths).toHaveProperty('/api/v1/admin/appearance');
    expect(paths).toHaveProperty('/api/v1/appearance');

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

  it('applies all presets, audits real changes, ignores no-ops, and survives an app rebuild', async () => {
    for (const themePreset of ['moe', 'neon', 'archive', 'pixel'] satisfies ThemePreset[]) {
      const response = await app.inject({
        headers: { cookie: adminCookie, origin: TEST_ORIGIN },
        method: 'PUT',
        payload: { themePreset },
        url: '/api/v1/admin/appearance',
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<Appearance>()).toEqual({ themePreset });
    }

    const invalid = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'PUT',
      payload: { themePreset: 'custom' },
      url: '/api/v1/admin/appearance',
    });
    expect(invalid.statusCode).toBe(400);

    const [beforeNoOp] = await database.orm
      .select()
      .from(platformAppearance)
      .where(eq(platformAppearance.id, 'global'));
    const [auditCountBefore] = await database.orm
      .select({ value: count() })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'platform-appearance.updated'));

    const noOp = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'PUT',
      payload: { themePreset: 'pixel' },
      url: '/api/v1/admin/appearance',
    });
    expect(noOp.statusCode, noOp.body).toBe(200);

    const [afterNoOp] = await database.orm
      .select()
      .from(platformAppearance)
      .where(eq(platformAppearance.id, 'global'));
    const [auditCountAfter] = await database.orm
      .select({ value: count() })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'platform-appearance.updated'));
    expect(afterNoOp?.updatedAt).toEqual(beforeNoOp?.updatedAt);
    expect(auditCountAfter?.value).toBe(auditCountBefore?.value);

    const audit = await database.orm
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'platform-appearance.updated'));
    expect(audit).toHaveLength(3);
    expect(audit.at(-1)).toMatchObject({
      actorUserId: adminId,
      afterSummary: { themePreset: 'pixel' },
      beforeSummary: { themePreset: 'archive' },
      targetId: 'global',
      targetType: 'platform-appearance',
    });

    await app.close();
    const config = createTestConfig({ databaseUrl: integrationDatabase.databaseUrl });
    auth = createAuth({ config, database });
    app = await buildApp({
      auth,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });
    const afterRebuild = await app.inject({ method: 'GET', url: '/api/v1/appearance' });
    expect(afterRebuild.json<Appearance>()).toEqual({ themePreset: 'pixel' });
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
