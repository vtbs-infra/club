import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth } from '../../src/server/modules/auth/auth.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import type { PortalHome } from '../../src/shared/contracts/portal.js';
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

integration('public portal visibility', () => {
  let adminCookie: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let creatorOneCookie: string;
  let creatorTwoCookie: string;
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let storage: TemporaryStorage;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('portal');
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
    adminCookie = await signInTestUser({ app, email: 'admin@example.com' });
    await promoteTestCreator({
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
    creatorOneCookie = await signInTestUser({ app, email: 'creator-one@example.com' });
    creatorTwoCookie = await signInTestUser({ app, email: 'creator-two@example.com' });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (storage) await storage.cleanup();
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('publishes only explicitly public and currently active content', async () => {
    const publicRelease = createReleaseDraft('2026-08-01', {
      description: '本月舰长纪念礼物。',
      fulfillmentMode: 'HIGHEST_ONLY',
      packages: [
        {
          description: '',
          items: [{ description: '', name: '纪念徽章', quantity: 1 }],
          name: '八月礼物',
        },
      ],
      publicVisible: true,
      tierPackageIndexes: { ADMIRAL: 0, CAPTAIN: 0, GOVERNOR: 0 },
      title: '八月舰长礼物',
    });
    const created = await app.inject({
      headers: { cookie: creatorOneCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: publicRelease,
      url: '/api/v1/creator/releases',
    });
    expect(created.statusCode, created.body).toBe(201);

    const draftPortal = await app.inject({ method: 'GET', url: '/api/v1/portal/home' });
    expect(draftPortal.statusCode, draftPortal.body).toBe(200);
    expect(draftPortal.json<PortalHome>().releases).toHaveLength(0);

    const draft = created.json<{ id: string; version: number }>();
    const published = await app.inject({
      headers: { cookie: creatorOneCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: { ...publicRelease, expectedVersion: draft.version },
      url: `/api/v1/creator/releases/${draft.id}/publish`,
    });
    expect(published.statusCode, published.body).toBe(200);

    const privateRelease = createReleaseDraft('2026-09-01', {
      publicVisible: false,
      title: '九月登录后可见礼物',
    });
    const privateDraftResponse = await app.inject({
      headers: { cookie: creatorTwoCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: privateRelease,
      url: '/api/v1/creator/releases',
    });
    expect(privateDraftResponse.statusCode, privateDraftResponse.body).toBe(201);
    const privateDraft = privateDraftResponse.json<{ id: string; version: number }>();
    const privatePublished = await app.inject({
      headers: { cookie: creatorTwoCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: { ...privateRelease, expectedVersion: privateDraft.version },
      url: `/api/v1/creator/releases/${privateDraft.id}/publish`,
    });
    expect(privatePublished.statusCode, privatePublished.body).toBe(200);

    const creatorAnnouncement = await app.inject({
      headers: { cookie: creatorOneCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {
        body: '只应显示给相关礼物领取用户。',
        pinned: false,
        publicVisible: false,
        publishNow: true,
        severity: 'INFO',
        title: '主播定向公告',
      },
      url: '/api/v1/creator/announcements',
    });
    expect(creatorAnnouncement.statusCode, creatorAnnouncement.body).toBe(201);

    const platformAnnouncement = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {
        body: '本月礼物已经开放领取。',
        pinned: true,
        publicVisible: true,
        publishNow: true,
        severity: 'INFO',
        title: '八月礼物领取通知',
      },
      url: '/api/v1/admin/announcements',
    });
    expect(platformAnnouncement.statusCode, platformAnnouncement.body).toBe(201);
    const loginOnlyAnnouncement = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {
        body: '这条公告只应在登录后显示。',
        pinned: false,
        publicVisible: false,
        publishNow: true,
        severity: 'INFO',
        title: '登录用户公告',
      },
      url: '/api/v1/admin/announcements',
    });
    expect(loginOnlyAnnouncement.statusCode, loginOnlyAnnouncement.body).toBe(201);

    const managedAnnouncement = platformAnnouncement.json<{ id: string; version: number }>();
    const updatedAnnouncement = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'PUT',
      payload: {
        body: '本月礼物已经开放领取，记得及时确认。',
        expectedVersion: managedAnnouncement.version,
        expiresAt: null,
        pinned: true,
        publicVisible: true,
        publishNow: true,
        severity: 'INFO',
        title: '八月礼物领取通知',
      },
      url: `/api/v1/admin/announcements/${managedAnnouncement.id}`,
    });
    expect(updatedAnnouncement.statusCode, updatedAnnouncement.body).toBe(200);

    const publicPortal = await app.inject({ method: 'GET', url: '/api/v1/portal/home' });
    expect(publicPortal.statusCode, publicPortal.body).toBe(200);
    const portal = publicPortal.json<PortalHome>();
    expect(portal.announcements).toHaveLength(1);
    expect(portal.releases).toHaveLength(1);
    expect(portal).toMatchObject({
      announcements: [
        {
          pinned: true,
          summary: '本月礼物已经开放领取，记得及时确认。',
          title: '八月礼物领取通知',
        },
      ],
      releases: [
        {
          coverImageUrl: null,
          creatorName: 'Creator 001',
          description: '本月舰长纪念礼物。',
          id: draft.id,
          title: '八月舰长礼物',
        },
      ],
    });
  });
});
