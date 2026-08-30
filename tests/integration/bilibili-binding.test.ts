import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth } from '../../src/server/modules/auth/auth.js';
import { FakeLiveMessageSource } from '../../src/server/modules/bilibili/fake-live-message-source.js';
import {
  createBindingRuntime,
  type BindingRuntime,
} from '../../src/server/modules/binding/binding-runtime.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import {
  registerTestUser,
  signInTestUser,
  TEST_PASSWORD,
  TEST_ORIGIN,
} from '../helpers/auth-session.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';

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

integration('platform verification rooms and Bilibili UID binding', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let runtime: BindingRuntime;
  let source: FakeLiveMessageSource;
  let storage: TemporaryStorage;
  let adminCookie: string;
  let aliceCookie: string;
  let bobCookie: string;
  let charlieCookie: string;
  let roomA: RoomResponse;
  let roomB: RoomResponse;

  async function createRoom(
    biliRoomId: string,
    displayName: string,
    priority: number,
  ): Promise<RoomResponse> {
    const response = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {
        biliRoomId,
        displayName,
        priority,
      },
      url: '/api/v1/admin/verification-rooms',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<RoomResponse>();
  }

  async function issue(
    cookie: string,
    remoteAddress = '127.0.0.1',
  ): Promise<LightMyRequestResponse> {
    const response = await app.inject({
      headers: { cookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {},
      remoteAddress,
      url: '/api/v1/me/bilibili-challenges',
    });
    if (response.statusCode === 201) {
      const roomId = response.json<ChallengeResponse>().room.link.split('/').at(-1)!;
      await expect.poll(() => source.activeConnectionCount(roomId), { timeout: 1_000 }).toBe(1);
    }
    return response;
  }

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('binding');
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

    for (const [name, email] of [
      ['Alice', 'alice@example.com'],
      ['Bob', 'bob@example.com'],
      ['Charlie', 'charlie@example.com'],
    ] as const) {
      await registerTestUser({ app, database, email, name });
    }
    adminCookie = await signInTestUser({ app, email: 'admin@example.com' });
    aliceCookie = await signInTestUser({ app, email: 'alice@example.com' });
    bobCookie = await signInTestUser({ app, email: 'bob@example.com' });
    charlieCookie = await signInTestUser({ app, email: 'charlie@example.com' });
    roomA = await createRoom('10001', 'Primary room', 10);
    roomB = await createRoom('10002', 'Fallback room', 20);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (storage) await storage.cleanup();
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('lets only a platform administrator configure and test verification rooms', async () => {
    const forbidden = await app.inject({
      headers: { cookie: aliceCookie },
      method: 'GET',
      url: '/api/v1/admin/verification-rooms',
    });
    expect(forbidden.statusCode).toBe(403);

    source.failNextConnections(roomA.biliRoomId);
    const failed = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {},
      url: `/api/v1/admin/verification-rooms/${roomA.id}/test`,
    });
    expect(failed.statusCode, failed.body).toBe(502);
    const [unhealthyRoom] = await database.orm
      .select({ healthStatus: verificationRooms.healthStatus })
      .from(verificationRooms)
      .where(eq(verificationRooms.id, roomA.id));
    expect(unhealthyRoom?.healthStatus).toBe('UNHEALTHY');
    const [failedAudit] = await database.orm
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'verification-room.connectivity-failed'))
      .limit(1);
    expect(failedAudit?.action).toBe('verification-room.connectivity-failed');

    for (const room of [roomA, roomB]) {
      const response = await app.inject({
        headers: { cookie: adminCookie, origin: TEST_ORIGIN },
        method: 'POST',
        payload: {},
        url: `/api/v1/admin/verification-rooms/${room.id}/test`,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ healthStatus: 'HEALTHY' });
    }
  });

  it('binds only an assigned-room proof, records UID conflicts, and preserves history', async () => {
    const rejected = await app.inject({
      headers: { cookie: aliceCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: { roomId: roomB.id, uid: '123456789' },
      url: '/api/v1/me/bilibili-challenges',
    });
    expect(rejected.statusCode).toBe(400);

    const aliceIssued = await issue(aliceCookie);
    expect(aliceIssued.statusCode, aliceIssued.body).toBe(201);
    const aliceChallenge = aliceIssued.json<ChallengeResponse>();
    expect(aliceChallenge.code).toMatch(/^CLUB-[A-HJ-NP-Z2-9]{6}$/);
    expect(aliceChallenge.room.link).toBe('https://live.bilibili.com/10001');
    const [stored] = await database.orm
      .select({ codeDigest: bindingChallenges.codeDigest })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.id, aliceChallenge.id));
    expect(stored?.codeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.codeDigest).not.toContain(aliceChallenge.code);
    const disablePrimary = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'PATCH',
      payload: { enabled: false },
      url: `/api/v1/admin/verification-rooms/${roomA.id}`,
    });
    expect(disablePrimary.statusCode).toBe(200);
    const bobResponse = await issue(bobCookie);
    expect(bobResponse.statusCode, bobResponse.body).toBe(201);
    const bobChallenge = bobResponse.json<ChallengeResponse>();
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
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'PATCH',
      payload: { enabled: true },
      url: `/api/v1/admin/verification-rooms/${roomA.id}`,
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
    await source.emitMessage({
      biliDisplayName: 'Same UID',
      biliUid: '123456789',
      eventId: 'uid-conflict-event',
      message: bobChallenge.code,
      roomId: roomB.biliRoomId,
    });
    const conflictState = await app.inject({
      headers: { cookie: bobCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-challenges/current',
    });
    expect(conflictState.json()).toMatchObject({ status: 'CONFLICT' });
    const [record] = await database.orm
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'bilibili-binding.conflict'))
      .limit(1);
    expect(record?.action).toBe('bilibili-binding.conflict');
    const unbound = await app.inject({
      headers: { cookie: aliceCookie, origin: TEST_ORIGIN },
      method: 'DELETE',
      url: '/api/v1/me/bilibili-binding',
    });
    expect(unbound.statusCode).toBe(204);
    const [history] = await database.orm
      .select({ unboundAt: bilibiliBindings.unboundAt })
      .from(bilibiliBindings)
      .where(eq(bilibiliBindings.biliUid, '123456789'))
      .orderBy(desc(bilibiliBindings.boundAt))
      .limit(1);
    expect(history?.unboundAt).toBeInstanceOf(Date);
  });

  it('projects expiry without a read-side write and lets the runtime persist it', async () => {
    await registerTestUser({ app, database, email: 'dave@example.com', name: 'Dave' });
    const daveCookie = await signInTestUser({ app, email: 'dave@example.com' });
    const issued = await issue(daveCookie, '192.0.2.40');
    expect(issued.statusCode, issued.body).toBe(201);
    const challenge = issued.json<ChallengeResponse>();
    const roomId = challenge.room.link.split('/').at(-1)!;
    await database.orm
      .update(bindingChallenges)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(bindingChallenges.id, challenge.id));

    const [beforeRead] = await database.orm
      .select({ status: bindingChallenges.status, updatedAt: bindingChallenges.updatedAt })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.id, challenge.id));
    expect(beforeRead?.status).toBe('ACTIVE');
    const projectedState = await app.inject({
      headers: { cookie: daveCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-challenges/current',
    });
    expect(projectedState.json()).toMatchObject({ connectionState: null, status: 'EXPIRED' });
    const [afterRead] = await database.orm
      .select({ status: bindingChallenges.status, updatedAt: bindingChallenges.updatedAt })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.id, challenge.id));
    expect(afterRead).toEqual(beforeRead);

    await source.emitMessage({
      biliDisplayName: 'Too late',
      biliUid: '444444444',
      eventId: 'expired-challenge-event',
      message: challenge.code,
      roomId,
    });
    await runtime.bindings.reconcileConnections();
    const state = await app.inject({
      headers: { cookie: daveCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-challenges/current',
    });
    expect(state.json()).toMatchObject({ status: 'EXPIRED' });
    const [expiredChallenge] = await database.orm
      .select({ status: bindingChallenges.status })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.id, challenge.id));
    expect(expiredChallenge?.status).toBe('EXPIRED');
    const [binding] = await database.orm
      .select({ id: bilibiliBindings.id })
      .from(bilibiliBindings)
      .where(eq(bilibiliBindings.biliUid, '444444444'))
      .limit(1);
    expect(binding).toBeUndefined();
  });

  it('rejects replayed proof messages from before challenge creation', async () => {
    await registerTestUser({ app, database, email: 'erin@example.com', name: 'Erin' });
    const erinCookie = await signInTestUser({ app, email: 'erin@example.com' });
    const issued = await issue(erinCookie, '192.0.2.41');
    expect(issued.statusCode, issued.body).toBe(201);
    const challenge = issued.json<ChallengeResponse>();
    const roomId = challenge.room.link.split('/').at(-1)!;
    const [stored] = await database.orm
      .select({ createdAt: bindingChallenges.createdAt })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.id, challenge.id))
      .limit(1);
    if (!stored) throw new Error('Binding challenge was not persisted.');

    await source.emitMessage({
      biliDisplayName: 'Replayed history user',
      biliUid: '555555555',
      eventId: 'pre-challenge-history-event',
      message: challenge.code,
      occurredAt: new Date(stored.createdAt.getTime() - 10_000),
      roomId,
    });
    const state = await app.inject({
      headers: { cookie: erinCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-challenges/current',
    });
    expect(state.json()).toMatchObject({ status: 'ACTIVE' });
    const [binding] = await database.orm
      .select({ id: bilibiliBindings.id })
      .from(bilibiliBindings)
      .where(eq(bilibiliBindings.biliUid, '555555555'))
      .limit(1);
    expect(binding).toBeUndefined();
  });

  it('lets a platform administrator remove a binding with an audited reason', async () => {
    await registerTestUser({ app, database, email: 'frank@example.com', name: 'Frank' });
    const frankCookie = await signInTestUser({ app, email: 'frank@example.com' });
    const issued = await issue(frankCookie, '192.0.2.50');
    expect(issued.statusCode, issued.body).toBe(201);
    const challenge = issued.json<ChallengeResponse>();
    await source.emitMessage({
      biliDisplayName: 'Frank on Bilibili',
      biliUid: '666666666',
      eventId: 'administrator-removal-binding-event',
      message: challenge.code,
      roomId: challenge.room.link.split('/').at(-1)!,
    });
    const bindingResponse = await app.inject({
      headers: { cookie: frankCookie },
      method: 'GET',
      url: '/api/v1/me/bilibili-binding',
    });
    const binding = bindingResponse.json<BindingResponse>();
    expect(binding.biliUid).toBe('666666666');

    const removed = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'DELETE',
      payload: { reason: 'Resolved a verified account ownership request.' },
      url: `/api/v1/admin/bilibili-bindings/${binding.id}`,
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
    expect(latest?.room.link).toContain('https://live.bilibili.com/');
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
});
