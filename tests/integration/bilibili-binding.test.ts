import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth, type AppAuth } from '../../src/server/modules/auth/auth.js';
import { FakeLiveMessageSource } from '../../src/server/modules/bilibili/fake-live-message-source.js';
import {
  createBindingRuntime,
  type BindingRuntime,
} from '../../src/server/modules/binding/binding-runtime.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const origin = 'http://localhost:3000';

interface RoomResponse {
  readonly biliRoomId: string;
  readonly healthStatus: string;
  readonly id: string;
}

interface ChallengeResponse {
  readonly code: string;
  readonly id: string;
  readonly room: { readonly link: string };
}

interface BindingResponse {
  readonly biliUid: string;
  readonly id: string;
}

interface ErrorResponse {
  readonly error: { readonly code: string };
}

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

integration('platform verification rooms and Bilibili UID binding', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let auth: AppAuth;
  let database: DatabaseService;
  let runtime: BindingRuntime;
  let source: FakeLiveMessageSource;
  let storage: TemporaryStorage;
  let adminCookie: string;
  let aliceCookie: string;
  let bobCookie: string;
  let charlieCookie: string;
  let roomA: RoomResponse;
  let roomB: RoomResponse;
  let aliceChallenge: ChallengeResponse;
  let bobChallenge: ChallengeResponse;
  let restartRoomId: string;

  async function register(name: string, email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      payload: { email, name, password: 'correct-horse-battery-staple' },
      url: '/api/auth/sign-up/email',
    });
    expect(response.statusCode, response.body).toBe(200);
    const [user] = await database.orm
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) throw new Error(`Registration did not create ${email}.`);
    return user.id;
  }

  async function signIn(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      payload: { email, password: 'correct-horse-battery-staple' },
      url: '/api/auth/sign-in/email',
    });
    expect(response.statusCode, response.body).toBe(200);
    return cookieFrom(response);
  }

  async function createRoom(
    biliRoomId: string,
    displayName: string,
    priority: number,
  ): Promise<RoomResponse> {
    const response = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'POST',
      payload: {
        biliOwnerUid: `9${biliRoomId}`,
        biliRoomId,
        displayName,
        priority,
      },
      url: '/api/v1/platform/verification-rooms',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<RoomResponse>();
  }

  async function issue(
    cookie: string,
    remoteAddress = '127.0.0.1',
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      headers: { cookie, origin },
      method: 'POST',
      payload: {},
      remoteAddress,
      url: '/api/v1/me/bilibili-challenges',
    });
  }

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    storage = await createTemporaryStorage();
    await database.orm.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        bilibili_bindings,
        binding_challenges,
        verification_rooms,
        member_creator_scopes,
        creators,
        organization_members,
        organizations,
        sessions,
        accounts,
        verifications,
        users
      CASCADE
    `);
    const config = createTestConfig({ databaseUrl: testDatabaseUrl! });
    auth = createAuth({ config, database });
    await bootstrapPlatformAdmin({
      auth,
      database,
      email: 'admin@example.com',
      name: 'Platform Admin',
      password: 'correct-horse-battery-staple',
    });
    source = new FakeLiveMessageSource();
    runtime = createBindingRuntime({
      clock: { now: () => new Date() },
      config,
      database,
      idleGraceMs: 0,
      reconnectDelaysMs: [1],
      source,
    });
    app = await buildApp({
      auth,
      bindingRuntime: runtime,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });

    await register('Alice', 'alice@example.com');
    await register('Bob', 'bob@example.com');
    await register('Charlie', 'charlie@example.com');
    adminCookie = await signIn('admin@example.com');
    aliceCookie = await signIn('alice@example.com');
    bobCookie = await signIn('bob@example.com');
    charlieCookie = await signIn('charlie@example.com');
  });

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
    if (storage) await storage.cleanup();
  });

  it('lets only a platform administrator configure and test verification rooms', async () => {
    const forbidden = await app.inject({
      headers: { cookie: aliceCookie },
      method: 'GET',
      url: '/api/v1/platform/verification-rooms',
    });
    expect(forbidden.statusCode).toBe(403);

    roomA = await createRoom('10001', 'Primary room', 10);
    roomB = await createRoom('10002', 'Fallback room', 20);
    for (const room of [roomA, roomB]) {
      const response = await app.inject({
        headers: { cookie: adminCookie, origin },
        method: 'POST',
        payload: {},
        url: `/api/v1/platform/verification-rooms/${room.id}/test`,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ healthStatus: 'HEALTHY' });
    }
  });

  it('never accepts a user-supplied room ID or UID and stores only a code digest', async () => {
    const rejected = await app.inject({
      headers: { cookie: aliceCookie, origin },
      method: 'POST',
      payload: { roomId: roomB.id, uid: '123456789' },
      url: '/api/v1/me/bilibili-challenges',
    });
    expect(rejected.statusCode).toBe(400);

    const response = await issue(aliceCookie);
    expect(response.statusCode, response.body).toBe(201);
    aliceChallenge = response.json<ChallengeResponse>();
    expect(aliceChallenge.code).toMatch(/^CLUB-[A-HJ-NP-Z2-9]{6}$/);
    expect(aliceChallenge.room.link).toBe('https://live.bilibili.com/10001');
    const [stored] = await database.orm
      .select({ codeDigest: bindingChallenges.codeDigest })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.id, aliceChallenge.id));
    expect(stored?.codeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.codeDigest).not.toContain(aliceChallenge.code);
  });

  it('does not consume a challenge from the wrong room and binds the event UID once', async () => {
    const disablePrimary = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'PATCH',
      payload: { enabled: false },
      url: `/api/v1/platform/verification-rooms/${roomA.id}`,
    });
    expect(disablePrimary.statusCode).toBe(200);
    const bobResponse = await issue(bobCookie);
    expect(bobResponse.statusCode, bobResponse.body).toBe(201);
    bobChallenge = bobResponse.json<ChallengeResponse>();
    expect(bobChallenge.room.link).toBe('https://live.bilibili.com/10002');

    await source.emitMessage({
      biliDisplayName: 'Alice on Bilibili',
      biliUid: '123456789',
      eventId: 'wrong-room-event',
      message: aliceChallenge.code,
      roomId: roomB.biliRoomId,
    });
    const stillUnbound = await app.inject({
      headers: { cookie: aliceCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-binding',
    });
    expect(stillUnbound.json()).toBeNull();

    await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'PATCH',
      payload: { enabled: true },
      url: `/api/v1/platform/verification-rooms/${roomA.id}`,
    });
    await runtime.bindings.reconcileConnections();
    await source.emitMessage({
      biliDisplayName: 'Alice on Bilibili',
      biliUid: '123456789',
      eventId: 'correct-event',
      message: aliceChallenge.code,
      roomId: roomA.biliRoomId,
    });
    await source.emitMessage({
      biliDisplayName: 'Alice on Bilibili',
      biliUid: '123456789',
      eventId: 'correct-event',
      message: aliceChallenge.code,
      roomId: roomA.biliRoomId,
    });

    const bindingResponse = await app.inject({
      headers: { cookie: aliceCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-binding',
    });
    expect(bindingResponse.statusCode).toBe(200);
    expect(bindingResponse.json<BindingResponse>()).toMatchObject({ biliUid: '123456789' });
    const [active] = await database.orm
      .select({ value: count() })
      .from(bilibiliBindings)
      .where(isNull(bilibiliBindings.unboundAt));
    expect(active?.value).toBe(1);

    const cannotRebind = await issue(aliceCookie);
    expect(cannotRebind.statusCode).toBe(409);
    expect(cannotRebind.json<ErrorResponse>().error.code).toBe('BILIBILI_BINDING_EXISTS');
  });

  it('records a conflict when another user proves an already-bound UID', async () => {
    await source.emitMessage({
      biliDisplayName: 'Same UID',
      biliUid: '123456789',
      eventId: 'uid-conflict-event',
      message: bobChallenge.code,
      roomId: roomB.biliRoomId,
    });
    const response = await app.inject({
      headers: { cookie: bobCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-challenges/current',
    });
    expect(response.json()).toMatchObject({ status: 'CONFLICT' });
    const [record] = await database.orm
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'bilibili-binding.conflict'))
      .limit(1);
    expect(record?.action).toBe('bilibili-binding.conflict');
  });

  it('preserves binding history when a user unbinds', async () => {
    const response = await app.inject({
      headers: { cookie: aliceCookie, origin },
      method: 'DELETE',
      url: '/api/v1/me/bilibili-binding',
    });
    expect(response.statusCode).toBe(204);
    const [history] = await database.orm
      .select({ unboundAt: bilibiliBindings.unboundAt })
      .from(bilibiliBindings)
      .where(eq(bilibiliBindings.biliUid, '123456789'))
      .orderBy(desc(bilibiliBindings.boundAt))
      .limit(1);
    expect(history?.unboundAt).toBeInstanceOf(Date);
  });

  it('expires stale challenges before accepting their proof message', async () => {
    await register('Dave', 'dave@example.com');
    const daveCookie = await signIn('dave@example.com');
    const issued = await issue(daveCookie, '192.0.2.40');
    expect(issued.statusCode, issued.body).toBe(201);
    const challenge = issued.json<ChallengeResponse>();
    const roomId = challenge.room.link.split('/').at(-1)!;
    await database.orm
      .update(bindingChallenges)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(bindingChallenges.id, challenge.id));

    await source.emitMessage({
      biliDisplayName: 'Too late',
      biliUid: '444444444',
      eventId: 'expired-challenge-event',
      message: challenge.code,
      roomId,
    });
    const state = await app.inject({
      headers: { cookie: daveCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-challenges/current',
    });
    expect(state.json()).toMatchObject({ status: 'EXPIRED' });
    const [binding] = await database.orm
      .select({ id: bilibiliBindings.id })
      .from(bilibiliBindings)
      .where(eq(bilibiliBindings.biliUid, '444444444'))
      .limit(1);
    expect(binding).toBeUndefined();
  });

  it('lets a platform administrator remove a binding with an audited reason', async () => {
    const issued = await issue(bobCookie, '192.0.2.50');
    expect(issued.statusCode, issued.body).toBe(201);
    const challenge = issued.json<ChallengeResponse>();
    await source.emitMessage({
      biliDisplayName: 'Bob on Bilibili',
      biliUid: '123456789',
      eventId: 'administrator-removal-binding-event',
      message: challenge.code,
      roomId: challenge.room.link.split('/').at(-1)!,
    });
    const bindingResponse = await app.inject({
      headers: { cookie: bobCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-binding',
    });
    const binding = bindingResponse.json<BindingResponse>();
    expect(binding.biliUid).toBe('123456789');

    const removed = await app.inject({
      headers: { cookie: adminCookie, origin },
      method: 'DELETE',
      payload: { reason: 'Resolved a verified account ownership request.' },
      url: `/api/v1/platform/bilibili-bindings/${binding.id}`,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    const [record] = await database.orm
      .select({ action: auditLogs.action, reason: auditLogs.reason })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'bilibili-binding.administrator-removed'))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(record).toMatchObject({
      action: 'bilibili-binding.administrator-removed',
      reason: 'Resolved a verified account ownership request.',
    });
  });

  it('throttles challenge creation independently by account and IP', async () => {
    let latest: ChallengeResponse | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await issue(charlieCookie, '192.0.2.30');
      expect(response.statusCode, response.body).toBe(201);
      latest = response.json<ChallengeResponse>();
    }
    const limited = await issue(charlieCookie, '192.0.2.30');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    restartRoomId = latest!.room.link.split('/').at(-1)!;
    const [activeChallenges] = await database.orm
      .select({ value: count() })
      .from(bindingChallenges)
      .where(
        and(
          eq(bindingChallenges.status, 'ACTIVE'),
          eq(
            bindingChallenges.userId,
            database.orm
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, 'charlie@example.com')),
          ),
        ),
      );
    expect(activeChallenges?.value).toBe(1);
  });

  it('restores unexpired listening after restart and contains source failures', async () => {
    await app.close();
    source = new FakeLiveMessageSource();
    source.failNextConnections(restartRoomId);
    const config = createTestConfig({ databaseUrl: testDatabaseUrl! });
    runtime = createBindingRuntime({
      clock: { now: () => new Date() },
      config,
      database,
      idleGraceMs: 0,
      reconnectDelaysMs: [1],
      source,
    });
    auth = createAuth({ config, database });
    app = await buildApp({
      auth,
      bindingRuntime: runtime,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });

    await expect(runtime.start()).resolves.toBeUndefined();
    expect(runtime.connections.getState(restartRoomId)).toBe('UNHEALTHY');
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    await expect
      .poll(() => source.activeConnectionCount(restartRoomId), { timeout: 1_000 })
      .toBe(1);
    await expect
      .poll(() => runtime.connections.getState(restartRoomId), { timeout: 1_000 })
      .toBe('HEALTHY');

    const [restoredRoom] = await database.orm
      .select({ healthStatus: verificationRooms.healthStatus })
      .from(verificationRooms)
      .where(eq(verificationRooms.biliRoomId, restartRoomId));
    expect(restoredRoom?.healthStatus).toBe('HEALTHY');
  });
});
