import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import {
  verificationRooms,
  identityChallenges,
} from '../../src/server/infrastructure/db/schema/index.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import { seedTestUser } from '../helpers/auth-session.js';
import type {
  BilibiliLoginAttempt,
  BilibiliSessionStatus,
} from '../../src/shared/contracts/bilibili.js';
import type { IdentityChallenge } from '../../src/shared/contracts/auth.js';
import { createIntegrationDatabase } from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';
import { FakeBilibiliPassport } from '../helpers/fake-bilibili-passport.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import { FakeGuardRosterSource } from '../helpers/fake-guard-roster-source.js';
import { FakeCreatorProfileSource } from '../helpers/fake-creator-profile-source.js';

describe('Bilibili management through authenticated HTTP', () => {
  let fixture: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let storage: Awaited<ReturnType<typeof createTemporaryStorage>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let now: Date;
  const clock = { now: () => now };
  let passport: FakeBilibiliPassport;
  let live: FakeLiveMessageSource;
  const origin = 'http://localhost:3000';
  const password = 'admin-password-for-testing';
  let cookie = '';
  const post = (url: string, payload: unknown, browser = cookie) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: { origin, cookie: browser },
    });
  const get = (url: string, browser = cookie) =>
    app.inject({ method: 'GET', url, headers: { cookie: browser } });
  const cookieFrom = (response: { cookies: { name: string; value: string }[] }) =>
    response.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
  beforeEach(async () => {
    now = new Date();
    passport = new FakeBilibiliPassport(clock);
    live = new FakeLiveMessageSource();
    fixture = await createIntegrationDatabase('bilibili_http');
    storage = await createTemporaryStorage();
    await seedTestUser({
      database: fixture.database,
      username: 'admin',
      role: 'PLATFORM_ADMIN',
      name: 'Admin',
      password,
    });
    await fixture.database.orm
      .insert(verificationRooms)
      .values({ biliRoomId: '777001', displayName: 'Test verification room' });
    app = await buildApp({
      config: createTestConfig({ databaseUrl: fixture.databaseUrl }),
      database: fixture.database,
      clock,
      bilibiliPassport: passport,
      liveMessageSource: live,
      guardRosterSource: new FakeGuardRosterSource(),
      creatorProfileSource: new FakeCreatorProfileSource(),
      storage: storage.driver,
      startBackground: true,
    });
    await app.ready();
    const loggedIn = await post('/api/v1/auth/login', { username: 'admin', password }, '');
    expect(loggedIn.statusCode, loggedIn.body).toBe(200);
    cookie = cookieFrom(loggedIn);
  });
  afterEach(async () => {
    await app?.close();
    await storage?.cleanup();
    await fixture?.cleanup();
  });

  it('keeps readiness and password login available before configuration, but does not issue unusable challenges', async () => {
    expect((await get('/health/ready')).statusCode).toBe(200);
    expect((await get('/api/v1/admin/bilibili')).json<BilibiliSessionStatus>()).toMatchObject({
      validity: 'NOT_CONFIGURED',
      revision: 0,
    });
    const rejected = await post('/api/v1/auth/challenges', { purpose: 'REGISTER' }, '');
    expect(rejected.statusCode).toBe(503);
    expect(await fixture.database.orm.select().from(identityChallenges)).toHaveLength(0);
  });

  it('guards QR creation against anonymous access and cross-origin writes', async () => {
    const create = vi.spyOn(passport, 'createLogin');
    expect((await post('/api/v1/admin/bilibili/login-attempts', {}, '')).statusCode).toBe(401);
    const csrf = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/bilibili/login-attempts',
      payload: {},
      headers: { origin: 'https://other.example', cookie },
    });
    expect(csrf.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('requires explicit activation and keeps verified proof usable after reader disconnect', async () => {
    passport.waiting = true;
    const created = await post('/api/v1/admin/bilibili/login-attempts', {});
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    const login = created.json<BilibiliLoginAttempt>();
    expect(login).toMatchObject({ state: 'WAITING', account: null });
    expect(
      (await get('/api/v1/admin/bilibili')).json<BilibiliSessionStatus>().loginAttempt?.id,
    ).toBe(login.id);
    // Finish the pending response before advancing the clock used to schedule its next poll.
    await app.runtimes.bilibili.tick();
    passport.waiting = false;
    now = new Date(now.getTime() + 5000);
    await app.runtimes.bilibili.tick();
    expect(
      (await get(`/api/v1/admin/bilibili/login-attempts/${login.id}`)).json<BilibiliLoginAttempt>()
        .state,
    ).toBe('READY');
    expect(live.activeConnectionCount('777001')).toBe(0);
    const activated = await post(`/api/v1/admin/bilibili/login-attempts/${login.id}/activate`, {});
    expect(activated.statusCode, activated.body).toBe(200);
    expect(activated.json<BilibiliSessionStatus>().validity).toBe('VALID');
    await app.runtimes.identity.tick();
    expect(live.activeConnectionCount('777001')).toBe(1);
    const createdProof = await post('/api/v1/auth/challenges', { purpose: 'REGISTER' }, '');
    expect(createdProof.statusCode, createdProof.body).toBe(201);
    const proof = createdProof.json<IdentityChallenge>();
    const browser = cookieFrom(createdProof);
    await live.emitMessage({
      biliUid: '99887766',
      biliDisplayName: 'Member',
      eventId: 'http-proof',
      message: proof.code!,
      roomId: '777001',
      occurredAt: now,
    });
    const disconnected = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/bilibili/session',
      headers: { origin, cookie },
      payload: { revision: activated.json<BilibiliSessionStatus>().revision },
    });
    expect(disconnected.statusCode, disconnected.body).toBe(200);
    expect((await get('/health/ready')).statusCode).toBe(200);
    expect(
      (await get(`/api/v1/auth/challenges/${proof.id}`, browser)).json<IdentityChallenge>().status,
    ).toBe('VERIFIED');
    const registered = await post(
      '/api/v1/auth/register',
      { challengeId: proof.id, username: 'verified_member', name: 'Member', password },
      browser,
    );
    expect(registered.statusCode, registered.body).toBe(201);
  });
});
