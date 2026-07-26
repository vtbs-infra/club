import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth, type AppAuth } from '../../src/server/modules/auth/auth.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import {
  defaultSitePageContent,
  type SiteAdminState,
  type SiteAsset,
  type SiteHomeResponse,
} from '../../src/shared/site-content.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const origin = 'http://localhost:3000';

function cookieFrom(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('Authentication response did not set a session cookie.');
  return cookie;
}

function multipartImage(boundary: string, image: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

integration('homepage content publishing and image assets', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let auth: AppAuth;
  let database: DatabaseService;
  let storage: TemporaryStorage;
  let adminCookie: string;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    storage = await createTemporaryStorage();
    await database.orm.execute(sql`TRUNCATE TABLE users CASCADE`);
    const config = createTestConfig({ databaseUrl: testDatabaseUrl! });
    auth = createAuth({ config, database });
    await bootstrapPlatformAdmin({
      auth,
      database,
      email: 'site-admin@example.com',
      name: 'Site Admin',
      password: 'correct-horse-battery-staple',
    });
    app = await buildApp({
      auth,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });
    const signIn = await app.inject({
      method: 'POST',
      payload: {
        email: 'site-admin@example.com',
        password: 'correct-horse-battery-staple',
      },
      url: '/api/auth/sign-in/email',
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    adminCookie = cookieFrom(signIn);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
    if (storage) await storage.cleanup();
  });

  it('serves a safe default homepage before the first publish', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/site/home' });
    expect(response.statusCode, response.body).toBe(200);
    const home = response.json<SiteHomeResponse>();
    expect(home.content.site.name).toBe(defaultSitePageContent.site.name);
    expect(home.content.blocks.some((block) => block.type === 'hero')).toBe(true);
    expect(home.user).toBeNull();
  });

  it('keeps drafts private, publishes atomically, and rejects stale writers', async () => {
    const content = {
      ...defaultSitePageContent,
      site: { ...defaultSitePageContent.site, name: '星澜舰长礼物站' },
    };
    const saved = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'PUT',
      payload: { content, expectedDraftId: null },
      url: '/api/v1/platform/site/home/draft',
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const draft = saved.json<SiteAdminState>();
    expect(draft.draft.id).toBeTypeOf('string');
    expect(draft.published.id).toBeNull();

    const beforePublish = await app.inject({ method: 'GET', url: '/api/v1/site/home' });
    expect(beforePublish.json<SiteHomeResponse>().content.site.name).toBe(
      defaultSitePageContent.site.name,
    );

    const published = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'POST',
      payload: { expectedDraftId: draft.draft.id },
      url: '/api/v1/platform/site/home/publish',
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json<SiteAdminState>().published.version).toBe(1);
    const publicHome = await app.inject({ method: 'GET', url: '/api/v1/site/home' });
    expect(publicHome.json<SiteHomeResponse>().content.site.name).toBe('星澜舰长礼物站');

    const stale = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'PUT',
      payload: { content, expectedDraftId: null },
      url: '/api/v1/platform/site/home/draft',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: 'SITE_CONTENT_VERSION_CONFLICT' },
    });
  });

  it('re-encodes image uploads, serves immutable WebP, and deletes unused assets', async () => {
    const png = await sharp({
      create: {
        background: { alpha: 1, b: 180, g: 120, r: 80 },
        channels: 4,
        height: 120,
        width: 240,
      },
    })
      .png()
      .toBuffer();
    const boundary = 'club-site-asset-boundary';
    const upload = await app.inject({
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: adminCookie,
        origin,
      },
      method: 'POST',
      payload: multipartImage(boundary, png),
      url: '/api/v1/platform/site-assets',
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const asset = upload.json<SiteAsset>();
    expect(asset.mimeType).toBe('image/webp');
    expect(asset.width).toBe(240);
    expect(asset.height).toBe(120);
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);

    const image = await app.inject({ method: 'GET', url: asset.url });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/webp');
    expect(image.headers['cache-control']).toContain('immutable');
    expect(image.rawPayload.subarray(0, 4).toString()).toBe('RIFF');

    const removed = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'DELETE',
      url: `/api/v1/platform/site-assets/${asset.id}`,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await app.inject({ method: 'GET', url: asset.url })).statusCode).toBe(404);
  });
});
