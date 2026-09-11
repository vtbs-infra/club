import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bilibiliLoginAttempts,
  bilibiliSessions,
  sessions,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import { BilibiliProviderError } from '../../src/server/modules/bilibili/passport-client.js';
import {
  BilibiliSessionService,
  type BilibiliLoginOwner,
} from '../../src/server/modules/bilibili/session-service.js';
import { FakeBilibiliPassport } from '../helpers/fake-bilibili-passport.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

describe('managed Bilibili session lifecycle', () => {
  let fixture: IntegrationDatabase;
  let service: BilibiliSessionService;
  let passport: FakeBilibiliPassport;
  let owner: BilibiliLoginOwner;
  let instant = new Date('2026-09-12T00:00:00Z');
  const clock = { now: () => instant };
  const encryption = new EncryptionKeyRing({
    activeVersion: 1,
    keyRing: '1:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  });
  const advance = (ms: number) => {
    instant = new Date(instant.getTime() + ms);
  };
  beforeAll(async () => {
    fixture = await createIntegrationDatabase('bilibili_session');
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });
  beforeEach(async () => {
    await fixture.database.orm.execute(sql`truncate users, bilibili_sessions cascade`);
    instant = new Date('2026-09-12T00:00:00Z');
    owner = { actorUserId: randomUUID(), clubSessionId: randomUUID() };
    await fixture.database.orm.insert(users).values({
      id: owner.actorUserId,
      username: 'administrator',
      name: 'Admin',
      role: 'PLATFORM_ADMIN',
    });
    await fixture.database.orm.insert(sessions).values({
      id: owner.clubSessionId,
      userId: owner.actorUserId,
      authVersion: 1,
      data: {},
      expiresAt: new Date(instant.getTime() + 86_400_000),
    });
    passport = new FakeBilibiliPassport(clock);
    service = new BilibiliSessionService(fixture.database, clock, encryption, passport);
    await service.initialize();
  });
  afterEach(async () => {
    await service?.close();
    vi.restoreAllMocks();
  });

  async function candidate() {
    const login = await service.createLogin(owner);
    await service.tick();
    return login.id;
  }
  async function activate() {
    const id = await candidate();
    await service.activateLogin(id, owner);
    return id;
  }

  it('rejects partial operation ownership in the database', async () => {
    await expect(
      fixture.database.orm.update(bilibiliSessions).set({
        operationId: randomUUID(),
        operationExpiresAt: instant,
      }),
    ).rejects.toThrow();
    expect((await service.status(owner)).operation).toBeNull();
  });

  it('keeps encrypted candidates separate until explicit activation and clears terminal secrets', async () => {
    const id = await candidate();
    expect(service.isAvailable()).toBe(false);
    const ready = await service.getLogin(id, owner);
    expect(ready).toMatchObject({ state: 'READY', qrUrl: null, account: { uid: passport.uid } });
    const stored = await fixture.database.orm.select().from(bilibiliLoginAttempts);
    expect(JSON.stringify(stored)).not.toContain('private-');
    const result = await service.activateLogin(id, owner);
    expect(result).toMatchObject({ revision: 1, validity: 'VALID', loginAttempt: null });
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(service.snapshot().uid).toBe(passport.uid);
    const [applied] = await fixture.database.orm.select().from(bilibiliLoginAttempts);
    expect(applied).toMatchObject({
      state: 'APPLIED',
      qrContext: null,
      candidateCredentials: null,
    });
    expect((await service.activateLogin(id, owner)).revision).toBe(1);
  });

  it('does not expose a QR or candidate to another Club session, even for the same administrator', async () => {
    const id = await candidate();
    const other = { ...owner, clubSessionId: randomUUID() };
    expect((await service.status(other)).loginAttempt).toBeNull();
    await expect(service.getLogin(id, other)).rejects.toMatchObject({
      code: 'BILIBILI_LOGIN_NOT_FOUND',
    });
    await expect(service.activateLogin(id, other)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects activation after logout or privilege revocation', async () => {
    const id = await candidate();
    await fixture.database.orm
      .update(users)
      .set({ authVersion: 2 })
      .where(eq(users.id, owner.actorUserId));
    await expect(service.activateLogin(id, owner)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await fixture.database.orm.delete(sessions).where(eq(sessions.id, owner.clubSessionId));
    expect(await fixture.database.orm.select().from(bilibiliLoginAttempts)).toHaveLength(0);
    expect(service.isAvailable()).toBe(false);
  });

  it('expires candidates and prevents a cancelled poll from resurrecting them', async () => {
    const id = await candidate();
    advance(5 * 60_000);
    expect((await service.getLogin(id, owner)).state).toBe('EXPIRED');
    await expect(service.activateLogin(id, owner)).rejects.toMatchObject({
      code: 'BILIBILI_SESSION_CONFLICT',
    });
    const deferred =
      Promise.withResolvers<Awaited<ReturnType<FakeBilibiliPassport['pollLogin']>>>();
    vi.spyOn(passport, 'pollLogin').mockReturnValueOnce(deferred.promise);
    const pending = await service.createLogin(owner);
    const tick = service.tick();
    await vi.waitFor(() => expect(passport.pollLogin).toHaveBeenCalled());
    await service.cancelLogin(pending.id, owner);
    deferred.resolve({ status: 'COMPLETE', credentials: passport.credentials() });
    await tick;
    expect((await service.getLogin(pending.id, owner)).state).toBe('CANCELLED');
    expect(service.isAvailable()).toBe(false);
  });

  it('invalidates old reading contexts on replacement and rejects stale disconnects', async () => {
    await activate();
    const old = service.snapshot();
    passport.uid = '87654321';
    const next = await candidate();
    expect(service.snapshot().uid).toBe(old.uid);
    await service.activateLogin(next, owner);
    expect(old.signal.aborted).toBe(true);
    expect(service.snapshot().uid).toBe(passport.uid);
    await expect(service.disconnect(1, owner)).rejects.toMatchObject({
      code: 'BILIBILI_SESSION_CONFLICT',
    });
    await service.disconnect(2, owner);
    expect(service.isAvailable()).toBe(false);
    expect((await service.status(owner)).validity).toBe('NOT_CONFIGURED');
  });

  it('refreshes once, rotates the whole credential bundle, and invalidates old snapshots', async () => {
    await activate();
    const old = service.snapshot();
    passport.refreshRequired = true;
    await service.requestCheck(owner);
    await service.tick();
    expect(passport.refreshCount).toBe(1);
    expect(old.signal.aborted).toBe(true);
    expect(service.snapshot().cookies.SESSDATA).toBe('private-session-refresh-1');
    expect(await service.status(owner)).toMatchObject({
      revision: 2,
      validity: 'VALID',
      operation: null,
    });
    await service.tick();
    expect(passport.refreshCount).toBe(1);
    expect(
      JSON.stringify(await fixture.database.orm.select().from(bilibiliSessions)),
    ).not.toContain('private-');
  });

  it('recovers a persisted refresh response after interruption without refreshing again', async () => {
    await activate();
    passport.refreshRequired = true;
    const originalCheck = passport.check.bind(passport);
    vi.spyOn(passport, 'check').mockImplementation(async (credentials, signal) => {
      if (credentials.accessToken.includes('refresh-')) throw new Error('Simulated interruption');
      return originalCheck(credentials, signal);
    });
    await service.requestCheck(owner);
    await expect(service.tick()).rejects.toThrow('Simulated interruption');
    const [pending] = await fixture.database.orm.select().from(bilibiliSessions);
    expect(pending?.pendingCredentials).not.toBeNull();
    expect(pending?.operation).toBe('VERIFYING');
    await service.close();
    vi.restoreAllMocks();
    advance(61_000);
    service = new BilibiliSessionService(fixture.database, clock, encryption, passport);
    await service.initialize();
    await service.tick();
    expect(passport.refreshCount).toBe(1);
    expect(service.snapshot().cookies.SESSDATA).toBe('private-session-refresh-1');
  });

  it('never retries a refresh whose outcome was lost', async () => {
    await activate();
    passport.refreshRequired = true;
    vi.spyOn(passport, 'refresh').mockRejectedValue(
      new BilibiliProviderError('BILIBILI_REFRESH_UNCERTAIN'),
    );
    await service.requestCheck(owner);
    await service.tick();
    expect(await service.status(owner)).toMatchObject({
      validity: 'REAUTH_REQUIRED',
      errorCode: 'BILIBILI_REFRESH_UNCERTAIN',
    });
    advance(5 * 60 * 60_000);
    await service.tick();
    expect(passport.refresh).toHaveBeenCalledTimes(1);
    expect(service.isAvailable()).toBe(false);
  });

  it('rechecks credentials after restart even when an earlier read-only check still owns a lease', async () => {
    await activate();
    await fixture.database.orm.update(bilibiliSessions).set({
      operation: 'CHECKING',
      operationId: randomUUID(),
      operationExpiresAt: new Date(instant.getTime() + 60_000),
    });
    await service.close();
    service = new BilibiliSessionService(fixture.database, clock, encryption, passport);
    await service.initialize();
    await service.tick();
    expect(service.isAvailable()).toBe(false);
    expect((await service.status(owner)).validity).toBe('CHECKING');
    advance(61_000);
    await service.tick();
    expect(service.isAvailable()).toBe(true);
  });

  it('marks an abandoned refresh intent uncertain after its lease, without using the old token', async () => {
    await activate();
    const refresh = vi.spyOn(passport, 'refresh');
    await fixture.database.orm.update(bilibiliSessions).set({
      operation: 'REFRESHING',
      operationId: randomUUID(),
      operationExpiresAt: new Date(instant.getTime() - 1),
      validity: 'CHECKING',
      nextCheckAt: instant,
    });
    await service.tick();
    expect(refresh).not.toHaveBeenCalled();
    expect((await service.status(owner)).validity).toBe('REAUTH_REQUIRED');
  });

  it('ignores an obsolete failed check after disconnect', async () => {
    await activate();
    const deferred = Promise.withResolvers<Awaited<ReturnType<FakeBilibiliPassport['check']>>>();
    vi.spyOn(passport, 'check').mockReturnValueOnce(deferred.promise);
    await service.requestCheck(owner);
    const tick = service.tick();
    await vi.waitFor(() => expect(passport.check).toHaveBeenCalled());
    await service.disconnect(1, owner);
    deferred.reject(new BilibiliProviderError('BILIBILI_AUTH_REQUIRED'));
    await tick;
    expect(await service.status(owner)).toMatchObject({
      revision: 2,
      validity: 'NOT_CONFIGURED',
      account: null,
      errorCode: null,
    });
  });

  it('keeps valid credentials during transient failures and retries without logging out', async () => {
    await activate();
    vi.spyOn(passport, 'check').mockRejectedValueOnce(
      new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE'),
    );
    await service.requestCheck(owner);
    await service.tick();
    expect(await service.status(owner)).toMatchObject({
      validity: 'VALID',
      reachability: 'UNAVAILABLE',
    });
    expect(service.isAvailable()).toBe(true);
    advance(60_000);
    await service.tick();
    expect(await service.status(owner)).toMatchObject({
      validity: 'VALID',
      reachability: 'HEALTHY',
    });
  });

  it('keeps replacement credentials when an older refresh completes late', async () => {
    await activate();
    passport.refreshRequired = true;
    const deferred = Promise.withResolvers<ReturnType<FakeBilibiliPassport['credentials']>>();
    const refresh = vi.spyOn(passport, 'refresh').mockReturnValueOnce(deferred.promise);
    await service.requestCheck(owner);
    const ticking = service.tick();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    passport.refreshRequired = false;
    passport.uid = '87654321';
    const replacement = await candidate();
    await service.activateLogin(replacement, owner);
    deferred.resolve(passport.credentials('12345678', 'late-refresh'));
    await ticking;
    expect(service.snapshot().uid).toBe('87654321');
    expect(await service.status(owner)).toMatchObject({ revision: 2, validity: 'VALID' });
  });

  it('aborts refresh requests on disconnect and cannot restore their late results', async () => {
    await activate();
    passport.refreshRequired = true;
    const deferred = Promise.withResolvers<ReturnType<FakeBilibiliPassport['credentials']>>();
    const refresh = vi.spyOn(passport, 'refresh').mockReturnValueOnce(deferred.promise);
    await service.requestCheck(owner);
    const ticking = service.tick();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const signal = refresh.mock.calls[0]![1];
    await service.disconnect(1, owner);
    expect(signal.aborted).toBe(true);
    deferred.resolve(passport.credentials('12345678', 'late-refresh'));
    await ticking;
    expect(await service.status(owner)).toMatchObject({ revision: 2, validity: 'NOT_CONFIGURED' });
    const [row] = await fixture.database.orm.select().from(bilibiliSessions);
    expect(row).toMatchObject({ credentials: null, pendingCredentials: null });
  });

  it('revalidates administrator permissions after the activation network request', async () => {
    const id = await candidate();
    const deferred = Promise.withResolvers<Awaited<ReturnType<FakeBilibiliPassport['check']>>>();
    const check = vi.spyOn(passport, 'check').mockReturnValueOnce(deferred.promise);
    const activation = service.activateLogin(id, owner);
    const rejected = expect(activation).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    await fixture.database.orm
      .update(users)
      .set({ authVersion: 2 })
      .where(eq(users.id, owner.actorUserId));
    deferred.resolve({
      account: { uid: passport.uid, name: 'Reader', avatar: 'https://i0.hdslb.com/a.jpg' },
      refreshRequired: false,
    });
    await rejected;
    expect(service.isAvailable()).toBe(false);
    expect((await service.getLogin(id, owner)).state).toBe('FAILED');
  });

  it('allows a new scan after persisted credentials and QR tasks become unreadable', async () => {
    await activate();
    passport.waiting = true;
    await service.createLogin(owner);
    await service.close();
    const replacementKey = new EncryptionKeyRing({
      activeVersion: 2,
      keyRing: '2:AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
    });
    service = new BilibiliSessionService(fixture.database, clock, replacementKey, passport);
    await service.initialize();
    expect((await service.status(owner)).loginAttempt).toMatchObject({
      state: 'FAILED',
      qrUrl: null,
    });
    await service.tick();
    expect(await service.status(owner)).toMatchObject({
      validity: 'REAUTH_REQUIRED',
      errorCode: 'BILIBILI_CREDENTIALS_UNREADABLE',
      reachability: 'HEALTHY',
    });
    passport.waiting = false;
    await activate();
    expect(service.isAvailable()).toBe(true);
  });
});
