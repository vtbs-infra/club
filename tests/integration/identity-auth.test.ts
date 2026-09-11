import { FakeBilibiliReadingSession } from '../helpers/fake-bilibili-reading-session.js';
import { randomUUID } from 'node:crypto';
import { Signer } from '@fastify/cookie';
import { and, count, eq } from 'drizzle-orm';
import type { Session } from 'fastify';
import { afterEach, beforeEach, expect, it, describe } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createAuth } from '../../src/server/modules/auth/auth.js';
import { SESSION_COOKIE } from '../../src/server/modules/auth/session-store.js';
import {
  bootstrapPlatformAdmin,
  resetPlatformAdminPassword,
} from '../../src/server/modules/users/admin-bootstrap.js';
import {
  identityChallenges,
  auditLogs,
  passwordCredentials,
  sessions,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema/index.js';
import { InMemoryRateLimiter } from '../../src/server/infrastructure/security/request-security.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import type { IdentityChallenge, SessionState } from '../../src/shared/contracts/auth.js';
import { createIntegrationDatabase } from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import { FakeCreatorProfileSource } from '../helpers/fake-creator-profile-source.js';
import { FakeGuardRosterSource } from '../helpers/fake-guard-roster-source.js';

const PASSWORD = 'first-password-for-tests';
const NEXT_PASSWORD = 'second-password-for-tests';
const ORIGIN = 'http://localhost:3000';
const ROOM = '777001';

describe('username and verified UID authentication', () => {
  let fixture: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let storage: Awaited<ReturnType<typeof createTemporaryStorage>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let auth: ReturnType<typeof createAuth>;
  let source: FakeLiveMessageSource;
  let now = new Date();
  const clock = { now: () => now };
  const cookie = (response: { headers: { 'set-cookie'?: string | string[] | undefined } }) => {
    const header = response.headers['set-cookie'];
    return (Array.isArray(header) ? header : header ? [header] : [])
      .map((v) => v.split(';')[0])
      .join('; ');
  };
  const post = (url: string, payload: object, browser = '') =>
    app.inject({
      method: 'POST',
      url,
      payload,
      headers: { origin: ORIGIN, ...(browser ? { cookie: browser } : {}) },
    });
  const get = (url: string, browser = '') =>
    app.inject({ method: 'GET', url, headers: browser ? { cookie: browser } : {} });
  async function start(purpose: 'REGISTER' | 'RECOVER' = 'REGISTER', uid = '') {
    const result = await post(
      '/api/v1/auth/challenges',
      purpose === 'REGISTER' ? { purpose } : { purpose, biliUid: uid },
    );
    expect(result.statusCode, result.body).toBe(201);
    const browser = cookie(result);
    const challenge = result.json<IdentityChallenge>();
    await expect.poll(() => source.activeConnectionCount(ROOM)).toBe(1);
    return { browser, challenge };
  }
  async function verify(challenge: IdentityChallenge, uid: string, eventId = randomUUID()) {
    await source.emitMessage({
      roomId: ROOM,
      biliUid: uid,
      biliDisplayName: 'Test account',
      message: challenge.code!,
      occurredAt: now,
      eventId,
    });
  }
  async function login(username: string, password = PASSWORD) {
    const result = await post('/api/v1/auth/login', { username, password });
    expect(result.statusCode, result.body).toBe(200);
    return cookie(result);
  }
  async function register(username: string, uid: string) {
    const proof = await start();
    await verify(proof.challenge, uid);
    const result = await post(
      '/api/v1/auth/register',
      { challengeId: proof.challenge.id, username, name: username, password: PASSWORD },
      proof.browser,
    );
    expect(result.statusCode, result.body).toBe(201);
  }
  async function makeApp() {
    source = new FakeLiveMessageSource();
    app = await buildApp({
      bilibiliReadingSession: new FakeBilibiliReadingSession(),
      auth,
      config: createTestConfig({ databaseUrl: fixture.databaseUrl }),
      database: fixture.database,
      clock,
      liveMessageSource: source,
      creatorProfileSource: new FakeCreatorProfileSource(),
      guardRosterSource: new FakeGuardRosterSource(),
      storage: storage.driver,
      startBackground: true,
      challengeLimiter: new InMemoryRateLimiter(1000),
    });
    await app.ready();
  }
  beforeEach(async () => {
    now = new Date();
    fixture = await createIntegrationDatabase('identity_auth');
    storage = await createTemporaryStorage();
    auth = createAuth({
      config: createTestConfig({ databaseUrl: fixture.databaseUrl }),
      database: fixture.database,
      clock,
    });
    await fixture.database.orm
      .insert(verificationRooms)
      .values({ biliRoomId: ROOM, displayName: 'Test verification room' });
    await makeApp();
  });
  afterEach(async () => {
    try {
      if (app) await app.close();
    } finally {
      try {
        if (storage) await storage.cleanup();
      } finally {
        if (fixture) await fixture.cleanup();
      }
    }
  });

  it('keeps anonymous sessions and incomplete registration out of account tables', async () => {
    expect((await get('/api/v1/auth/session')).json()).toBeNull();
    const proof = await start();
    const response = await post(
      '/api/v1/auth/register',
      {
        challengeId: proof.challenge.id,
        username: 'premature',
        name: 'Premature',
        password: PASSWORD,
      },
      proof.browser,
    );
    expect(response.statusCode).toBe(409);
    expect(await fixture.database.orm.select({ value: count() }).from(users)).toEqual([
      { value: 0 },
    ]);
    expect(await fixture.database.orm.select({ value: count() }).from(sessions)).toEqual([
      { value: 0 },
    ]);
    expect((await get('/api/v1/auth/challenges/' + proof.challenge.id)).statusCode).toBe(400);
    const other = await start();
    expect(
      (await get('/api/v1/auth/challenges/' + proof.challenge.id, other.browser)).statusCode,
    ).toBe(404);
  });

  it('checks room, timestamp and browser ownership before accepting proof', async () => {
    const proof = await start();
    await source.emitMessage({
      roomId: ROOM,
      biliUid: '10001',
      biliDisplayName: null,
      message: proof.challenge.code!,
      occurredAt: new Date(now.getTime() - 60_000),
    });
    await source.emitMessage({
      roomId: '999999',
      biliUid: '10001',
      biliDisplayName: null,
      message: proof.challenge.code!,
      occurredAt: now,
    });
    expect(
      (await get('/api/v1/auth/challenges/' + proof.challenge.id, proof.browser)).json(),
    ).toMatchObject({ status: 'PENDING', biliUid: null, username: null });
    await verify(proof.challenge, '10001');
    const other = await start();
    expect(
      (
        await post(
          '/api/v1/auth/register',
          {
            challengeId: proof.challenge.id,
            username: 'stolen',
            name: 'Stolen',
            password: PASSWORD,
          },
          other.browser,
        )
      ).statusCode,
    ).toBe(409);
    const result = await post(
      '/api/v1/auth/register',
      { challengeId: proof.challenge.id, username: 'Alice', name: ' Alice ', password: PASSWORD },
      proof.browser,
    );
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json()).toMatchObject({ username: 'alice', name: 'Alice', bilibiliUid: '10001' });
    expect(result.headers['set-cookie']).toBeUndefined();
    const retry = await post(
      '/api/v1/auth/register',
      { challengeId: proof.challenge.id, username: 'again', name: 'Again', password: PASSWORD },
      proof.browser,
    );
    expect(retry.statusCode).toBe(409);
    const [credential] = await fixture.database.orm.select().from(passwordCredentials);
    expect(credential?.passwordHash).toMatch(/^scrypt\$1\$32768\$8\$3\$/);
    expect(credential?.passwordHash).not.toContain(PASSWORD);
  });

  it('rejects existing UID and lets an owner retry a username collision without consuming proof', async () => {
    await register('alice', '10001');
    const existing = await start();
    await verify(existing.challenge, '10001');
    expect(
      (
        await post(
          '/api/v1/auth/register',
          {
            challengeId: existing.challenge.id,
            username: 'duplicate',
            name: 'Duplicate',
            password: PASSWORD,
          },
          existing.browser,
        )
      ).json(),
    ).toMatchObject({ error: { code: 'UID_ALREADY_REGISTERED' } });
    const fresh = await start();
    await verify(fresh.challenge, '10002');
    const input = {
      challengeId: fresh.challenge.id,
      username: 'alice',
      name: 'Bob',
      password: PASSWORD,
    };
    expect((await post('/api/v1/auth/register', input, fresh.browser)).json()).toMatchObject({
      error: { code: 'USERNAME_TAKEN' },
    });
    expect(
      (await get('/api/v1/auth/challenges/' + fresh.challenge.id, fresh.browser)).json(),
    ).toMatchObject({ status: 'VERIFIED' });
    expect(
      (await post('/api/v1/auth/register', { ...input, username: 'bob' }, fresh.browser))
        .statusCode,
    ).toBe(201);
  });

  it('consumes proof atomically during concurrent registrations', async () => {
    const proof = await start();
    await verify(proof.challenge, '10003');
    const body = {
      challengeId: proof.challenge.id,
      username: 'concurrent',
      name: 'Concurrent',
      password: PASSWORD,
    };
    const results = await Promise.all([
      post('/api/v1/auth/register', body, proof.browser),
      post('/api/v1/auth/register', body, proof.browser),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(
      await fixture.database.orm
        .select({ value: count() })
        .from(users)
        .where(eq(users.bilibiliUid, '10003')),
    ).toEqual([{ value: 1 }]);
  });

  it('logs in case-insensitively, rotates sessions and protects writes against CSRF', async () => {
    await register('alice', '10001');
    const first = await login('ALICE');
    expect((await get('/api/v1/me', first)).json()).toMatchObject({
      user: { username: 'alice', bilibiliUid: '10001' },
    });
    const result = await post(
      '/api/v1/auth/login',
      { username: 'alice', password: PASSWORD },
      first,
    );
    expect(result.statusCode).toBe(200);
    const second = cookie(result);
    expect(second).not.toBe(first);
    expect((await get('/api/v1/me', first)).statusCode).toBe(401);
    expect((await get('/api/v1/me', second)).statusCode).toBe(200);
    expect(result.headers['set-cookie']).toContain('HttpOnly');
    expect(result.json<SessionState>().session.expiresAt).toBe(
      new Date(now.getTime() + 14 * 86400_000).toISOString(),
    );
    const csrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'alice', password: PASSWORD },
    });
    expect(csrf.statusCode).toBe(403);
    expect(
      (await post('/api/v1/auth/login', { username: 'alice', password: 'wrong' })).statusCode,
    ).toBe(401);
    expect((await get('/api/v1/me', SESSION_COOKIE + '=forged')).statusCode).toBe(401);
  });

  it('allows display-name changes while preserving username and UID', async () => {
    await register('bob', '10002');
    const browser = await login('bob');
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { origin: ORIGIN, cookie: browser },
      payload: { name: 'New Bob' },
    });
    expect(saved.statusCode).toBe(200);
    expect((await get('/api/v1/me', browser)).json()).toMatchObject({
      user: { username: 'bob', name: 'New Bob' },
    });
    await expect(
      fixture.database.orm
        .update(users)
        .set({ username: 'renamed' })
        .where(eq(users.username, 'bob')),
    ).rejects.toThrow();
    await expect(
      fixture.database.orm
        .update(users)
        .set({ bilibiliUid: '11111' })
        .where(eq(users.username, 'bob')),
    ).rejects.toThrow();
  });

  it('requires the expected UID for recovery and reveals username only after verification', async () => {
    await register('alice', '10001');
    const proof = await start('RECOVER', '10001');
    expect(proof.challenge).toMatchObject({ username: null, biliUid: null });
    await verify(proof.challenge, '10002');
    expect(
      (await get('/api/v1/auth/challenges/' + proof.challenge.id, proof.browser)).json(),
    ).toMatchObject({ status: 'PENDING', username: null });
    await verify(proof.challenge, '10001');
    expect(
      (await get('/api/v1/auth/challenges/' + proof.challenge.id, proof.browser)).json(),
    ).toMatchObject({ status: 'VERIFIED', username: 'alice', biliUid: '10001' });
  });

  it('revokes all sessions and outstanding recovery proofs after a password reset', async () => {
    await register('alice', '10001');
    const firstSession = await login('alice');
    const secondSession = await login('alice');
    const first = await start('RECOVER', '10001');
    const second = await start('RECOVER', '10001');
    await verify(first.challenge, '10001');
    await verify(second.challenge, '10001');
    expect(
      (
        await post(
          '/api/v1/auth/recover',
          { challengeId: first.challenge.id, password: NEXT_PASSWORD },
          first.browser,
        )
      ).statusCode,
    ).toBe(204);
    expect((await get('/api/v1/me', firstSession)).statusCode).toBe(401);
    expect((await get('/api/v1/me', secondSession)).statusCode).toBe(401);
    expect(
      (
        await post(
          '/api/v1/auth/recover',
          { challengeId: second.challenge.id, password: PASSWORD },
          second.browser,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await post('/api/v1/auth/login', { username: 'alice', password: PASSWORD })).statusCode,
    ).toBe(401);
    await login('alice', NEXT_PASSWORD);
  });

  it('keeps challenge purposes separate and does not recover an unregistered UID', async () => {
    const registration = await start();
    await verify(registration.challenge, '10001');
    expect(
      (
        await post(
          '/api/v1/auth/recover',
          {
            challengeId: registration.challenge.id,
            password: NEXT_PASSWORD,
          },
          registration.browser,
        )
      ).json(),
    ).toMatchObject({ error: { code: 'IDENTITY_PROOF_INVALID' } });
    const recovery = await start('RECOVER', '99910001');
    expect(recovery.challenge).toMatchObject({ username: null, biliUid: null, status: 'PENDING' });
    await verify(recovery.challenge, '99910001');
    expect(
      (await get('/api/v1/auth/challenges/' + recovery.challenge.id, recovery.browser)).json(),
    ).toMatchObject({
      status: 'VERIFIED',
      username: null,
      biliUid: '99910001',
    });
    expect(
      (
        await post(
          '/api/v1/auth/recover',
          {
            challengeId: recovery.challenge.id,
            password: PASSWORD,
          },
          recovery.browser,
        )
      ).json(),
    ).toMatchObject({ error: { code: 'RECOVERY_PROOF_STALE' } });
    expect(
      (
        await post(
          '/api/v1/auth/register',
          {
            challengeId: recovery.challenge.id,
            username: 'wrong_purpose',
            name: 'Wrong',
            password: PASSWORD,
          },
          recovery.browser,
        )
      ).json(),
    ).toMatchObject({ error: { code: 'IDENTITY_PROOF_INVALID' } });
  });

  it('prevents late session saves from resurrecting sessions revoked by change-password', async () => {
    await register('bob', '10002');
    const browser = await login('bob');
    const raw = decodeURIComponent(browser.split('=', 2)[1]!);
    const id = new Signer(createTestConfig().authSecret).unsign(raw).value!;
    const previous = await new Promise<Session>((resolve, reject) =>
      auth.store.get(id, (error, data) =>
        error
          ? reject(
              error instanceof Error ? error : new Error('Session store failed', { cause: error }),
            )
          : resolve(data!),
      ),
    );
    expect(
      (
        await post(
          '/api/v1/auth/password',
          { currentPassword: 'wrong', password: NEXT_PASSWORD },
          browser,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          '/api/v1/auth/password',
          { currentPassword: PASSWORD, password: NEXT_PASSWORD },
          browser,
        )
      ).statusCode,
    ).toBe(204);
    await new Promise<void>((resolve, reject) =>
      auth.store.set(id, previous, (error: unknown) =>
        error
          ? reject(
              error instanceof Error ? error : new Error('Session store failed', { cause: error }),
            )
          : resolve(),
      ),
    );
    expect((await get('/api/v1/me', browser)).statusCode).toBe(401);
    const current = await login('bob', NEXT_PASSWORD);
    expect((await post('/api/v1/auth/logout', {}, current)).statusCode).toBe(204);
    expect((await get('/api/v1/me', current)).statusCode).toBe(401);
  });

  it('expires both pending and verified challenges and does not reuse message events', async () => {
    const pending = await start();
    const verified = await start();
    const eventId = randomUUID();
    await verify(verified.challenge, '10004', eventId);
    const replay = await start();
    await verify(replay.challenge, '10005', eventId);
    expect(
      (await get('/api/v1/auth/challenges/' + replay.challenge.id, replay.browser)).json(),
    ).toMatchObject({ status: 'PENDING' });
    now = new Date(now.getTime() + 11 * 60_000);
    await verify(pending.challenge, '10006');
    expect(
      (await get('/api/v1/auth/challenges/' + pending.challenge.id, pending.browser)).json(),
    ).toMatchObject({ status: 'EXPIRED' });
    expect(
      (
        await post(
          '/api/v1/auth/register',
          {
            challengeId: verified.challenge.id,
            username: 'expired',
            name: 'Expired',
            password: PASSWORD,
          },
          verified.browser,
        )
      ).statusCode,
    ).toBe(409);
  });

  it('restores pending verification connections across application restart', async () => {
    const proof = await start();
    await app.close();
    await makeApp();
    await expect.poll(() => source.activeConnectionCount(ROOM)).toBe(1);
    await verify(proof.challenge, '10007');
    expect(
      (await get('/api/v1/auth/challenges/' + proof.challenge.id, proof.browser)).json(),
    ).toMatchObject({ status: 'VERIFIED' });
  });

  it('creates and resets administrators atomically without changing ordinary accounts', async () => {
    await register('alice', '10001');
    const ordinarySession = await login('alice');
    const [credentialBefore] = await fixture.database.orm.select().from(passwordCredentials);
    await bootstrapPlatformAdmin({
      database: fixture.database,
      username: 'admin',
      name: 'Admin',
      password: PASSWORD,
    });
    const admin = await login('admin');
    expect((await get('/api/v1/admin/verification-rooms', admin)).statusCode).toBe(200);
    await expect(
      bootstrapPlatformAdmin({
        database: fixture.database,
        username: 'alice',
        name: 'Duplicate',
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_ACCOUNT_ALREADY_EXISTS' });
    await expect(
      resetPlatformAdminPassword({
        database: fixture.database,
        username: 'alice',
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_ACCOUNT_NOT_FOUND' });
    await resetPlatformAdminPassword({
      database: fixture.database,
      username: 'admin',
      password: NEXT_PASSWORD,
    });
    expect((await get('/api/v1/me', admin)).statusCode).toBe(401);
    await login('admin', NEXT_PASSWORD);
    const [ordinary] = await fixture.database.orm
      .select()
      .from(users)
      .where(eq(users.username, 'alice'));
    expect(ordinary?.role).toBe('USER');
    const [credentialAfter] = await fixture.database.orm
      .select()
      .from(passwordCredentials)
      .where(eq(passwordCredentials.userId, ordinary!.id));
    expect(credentialAfter).toEqual(credentialBefore);
    expect((await get('/api/v1/me', ordinarySession)).statusCode).toBe(200);
    expect(
      await fixture.database.orm
        .select({ value: count() })
        .from(identityChallenges)
        .where(
          and(
            eq(identityChallenges.purpose, 'REGISTER'),
            eq(identityChallenges.status, 'CONSUMED'),
          ),
        ),
    ).toEqual([{ value: 1 }]);
  });

  it('expires sessions after fourteen days without extending their lifetime on access', async () => {
    await register('alice', '10001');
    const originalNow = now;
    const browser = await login('alice');
    const first = (await get('/api/v1/auth/session', browser)).json<SessionState>();
    try {
      now = new Date(originalNow.getTime() + 13 * 86400_000);
      const later = await get('/api/v1/auth/session', browser);
      expect(later.json<SessionState>().session.expiresAt).toBe(first.session.expiresAt);
      expect(later.headers['set-cookie']).toBeUndefined();
      now = new Date(originalNow.getTime() + 14 * 86400_000);
      expect((await get('/api/v1/auth/session', browser)).json()).toBeNull();
      expect((await get('/api/v1/me', browser)).statusCode).toBe(401);
    } finally {
      now = originalNow;
    }
  });

  it('audits completed credential changes without storing credentials or identity proofs', async () => {
    await register('alice', '10001');
    const browser = await login('alice');
    expect(
      (
        await post(
          '/api/v1/auth/password',
          { currentPassword: PASSWORD, password: NEXT_PASSWORD },
          browser,
        )
      ).statusCode,
    ).toBe(204);
    const proof = await start('RECOVER', '10001');
    await verify(proof.challenge, '10001');
    expect(
      (
        await post(
          '/api/v1/auth/recover',
          { challengeId: proof.challenge.id, password: PASSWORD },
          proof.browser,
        )
      ).statusCode,
    ).toBe(204);
    await bootstrapPlatformAdmin({
      database: fixture.database,
      username: 'admin',
      name: 'Admin',
      password: PASSWORD,
    });
    await resetPlatformAdminPassword({
      database: fixture.database,
      username: 'admin',
      password: NEXT_PASSWORD,
    });
    const rows = await fixture.database.orm.select().from(auditLogs);
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'auth.registered',
        'auth.password-changed',
        'auth.password-recovered',
        'platform-admin.bootstrapped',
        'platform-admin.password-reset',
      ]),
    );
    const encoded = JSON.stringify(rows);
    expect(encoded).not.toContain(PASSWORD);
    expect(encoded).not.toContain(NEXT_PASSWORD);
    expect(encoded).not.toContain('scrypt$');
    expect(encoded).not.toContain('CLUB-');
    expect(encoded).not.toContain('club_session');
  });
});
