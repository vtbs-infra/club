import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type {
  BilibiliLoginAttempt,
  BilibiliLoginState,
  BilibiliSessionStatus,
} from '../../../shared/contracts/bilibili.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliLoginAttempts as attempts,
  bilibiliSessions as slots,
  sessions,
  users,
} from '../../infrastructure/db/schema/index.js';
import {
  type EncryptionKeyRing,
  EncryptionError,
  type EncryptedValue,
} from '../../infrastructure/encryption/key-ring.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import {
  BilibiliProviderError,
  type BilibiliCredentials,
  type BilibiliPassport,
  type BilibiliQrLogin,
} from './passport-client.js';
import type { BilibiliReadingSession, BilibiliReadingSnapshot } from './reading-session.js';

type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type Slot = typeof slots.$inferSelect;
type Attempt = typeof attempts.$inferSelect;
export interface BilibiliLoginOwner extends RequestAuditContext {
  readonly clubSessionId: string;
}
const ACTIVE_STATES: BilibiliLoginState[] = [
  'CREATING',
  'WAITING',
  'VERIFYING',
  'READY',
  'ACTIVATING',
];
const LEASE_MS = 60_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
const RETRY_MS = 60_000;
const clearedOperation = { operation: null, operationId: null, operationExpiresAt: null };
const clearedAttempt = {
  qrContext: null,
  candidateCredentials: null,
  operationId: null,
  operationExpiresAt: null,
};
const conflict = () =>
  new AppError(
    'BILIBILI_SESSION_CONFLICT',
    'The Bilibili session changed. Reload and try again.',
    409,
  );
const missingAttempt = () =>
  new AppError('BILIBILI_LOGIN_NOT_FOUND', 'This login attempt is no longer available.', 404);

export class BilibiliSessionService implements BilibiliReadingSession {
  private readonly shutdown = new AbortController();
  private requestEpoch = new AbortController();
  private readonly network = new Set<Promise<unknown>>();
  private active: {
    credentials: BilibiliCredentials;
    revision: number;
    controller: AbortController;
  } | null = null;
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
    private readonly encryption: EncryptionKeyRing,
    private readonly passport: BilibiliPassport,
    private readonly changed: () => void = () => undefined,
    private readonly demandChanged: () => void = () => undefined,
  ) {
    this.audit = new AuditService(database);
  }

  private future(milliseconds: number): Date {
    return new Date(this.clock.now().getTime() + milliseconds);
  }

  private async request<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.shutdown.signal.throwIfAborted();
    const signal = AbortSignal.any([this.shutdown.signal, this.requestEpoch.signal]);
    const pending = run(signal);
    this.network.add(pending);
    try {
      return await pending;
    } catch (error) {
      if (signal.aborted && !this.shutdown.signal.aborted)
        throw new BilibiliProviderError('BILIBILI_AUTH_REQUIRED');
      throw error;
    } finally {
      this.network.delete(pending);
    }
  }

  private async ownerIsValid(owner: BilibiliLoginOwner, tx: Transaction): Promise<void> {
    const [row] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .innerJoin(
        users,
        and(eq(users.id, sessions.userId), eq(users.authVersion, sessions.authVersion)),
      )
      .where(
        and(
          eq(sessions.id, owner.clubSessionId),
          eq(users.id, owner.actorUserId),
          eq(users.role, 'PLATFORM_ADMIN'),
          gt(sessions.expiresAt, this.clock.now()),
        ),
      )
      .for('share');
    if (!row)
      throw new AppError('AUTH_REQUIRED', 'An active administrator session is required.', 401);
  }

  private async slot(tx: Transaction): Promise<Slot> {
    await tx.insert(slots).values({ id: 'global' }).onConflictDoNothing();
    const [row] = await tx.select().from(slots).where(eq(slots.id, 'global')).for('update');
    if (!row) throw new Error('Bilibili session service has not been initialized.');
    return row;
  }

  private async ownedAttempt(
    id: string,
    owner: BilibiliLoginOwner,
    tx: Transaction,
  ): Promise<Attempt> {
    const [row] = await tx
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.id, id),
          eq(attempts.adminUserId, owner.actorUserId),
          eq(attempts.clubSessionId, owner.clubSessionId),
        ),
      )
      .for('update');
    if (!row) throw missingAttempt();
    return row;
  }

  public async initialize(): Promise<void> {
    await this.database.orm.insert(slots).values({ id: 'global' }).onConflictDoNothing();
    // A process restart rechecks persisted credentials before opening reading connections.
    await this.database.orm
      .update(slots)
      .set({ validity: 'CHECKING', nextCheckAt: this.clock.now() })
      .where(and(eq(slots.id, 'global'), eq(slots.validity, 'VALID')));
  }

  public isAvailable(): boolean {
    return (
      this.active !== null &&
      !this.active.controller.signal.aborted &&
      Date.parse(this.active.credentials.expiresAt) > this.clock.now().getTime()
    );
  }

  public snapshot(): BilibiliReadingSnapshot {
    if (!this.isAvailable() || !this.active)
      throw new BilibiliProviderError('BILIBILI_AUTH_REQUIRED');
    return {
      revision: this.active.revision,
      uid: this.active.credentials.uid,
      cookies: this.active.credentials.cookies,
      signal: this.active.controller.signal,
    };
  }

  private async publish(): Promise<void> {
    const [row] = await this.database.orm.select().from(slots).where(eq(slots.id, 'global'));
    if (
      this.active &&
      (row?.validity !== 'VALID' || row.revision !== this.active.revision || !this.isAvailable())
    ) {
      this.active.controller.abort(new BilibiliProviderError('BILIBILI_AUTH_REQUIRED'));
      this.active = null;
      this.changed();
    }
    if (
      !this.shutdown.signal.aborted &&
      !this.active &&
      row?.validity === 'VALID' &&
      row.credentials
    ) {
      const credentials = this.decrypt<BilibiliCredentials>(row.credentials, 'bilibili:active');
      if (Date.parse(credentials.expiresAt) > this.clock.now().getTime()) {
        this.active = {
          revision: row.revision,
          credentials: { ...credentials, cookies: Object.freeze({ ...credentials.cookies }) },
          controller: new AbortController(),
        };
        this.changed();
      }
    }
  }

  private async viewAttempt(row: Attempt): Promise<BilibiliLoginAttempt> {
    let qrUrl: string | null = null;
    try {
      if (row.state === 'WAITING' && row.qrContext)
        qrUrl = this.decrypt<BilibiliQrLogin>(row.qrContext, `bilibili:qr:${row.id}`).url;
    } catch (error) {
      if (!(error instanceof BilibiliProviderError)) throw error;
      await this.finishAttempt(row.id, 'FAILED', error.code);
      return {
        id: row.id,
        state: 'FAILED',
        expiresAt: row.expiresAt.toISOString(),
        qrUrl: null,
        account: row.account,
        errorCode: error.code,
        baseRevision: row.baseRevision,
      };
    }
    return {
      id: row.id,
      state: row.state,
      expiresAt: row.expiresAt.toISOString(),
      qrUrl,
      account: row.account,
      errorCode: row.errorCode,
      baseRevision: row.baseRevision,
    };
  }

  public async status(owner: BilibiliLoginOwner): Promise<BilibiliSessionStatus> {
    const [row] = await this.database.orm.select().from(slots).where(eq(slots.id, 'global'));
    if (!row)
      return {
        revision: 0,
        validity: 'NOT_CONFIGURED',
        reachability: 'UNKNOWN',
        account: null,
        operation: null,
        errorCode: null,
        loggedInAt: null,
        checkedAt: null,
        refreshedAt: null,
        nextCheckAt: null,
        loginAttempt: null,
      };
    const [attempt] = await this.database.orm
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.adminUserId, owner.actorUserId),
          eq(attempts.clubSessionId, owner.clubSessionId),
          inArray(attempts.state, ACTIVE_STATES),
          gt(attempts.expiresAt, this.clock.now()),
        ),
      );
    return {
      revision: row.revision,
      validity: row.validity,
      reachability: row.reachability,
      account: row.account,
      operation: row.operation,
      errorCode: row.errorCode,
      loggedInAt: row.loggedInAt?.toISOString() ?? null,
      checkedAt: row.checkedAt?.toISOString() ?? null,
      refreshedAt: row.refreshedAt?.toISOString() ?? null,
      nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
      loginAttempt: attempt ? await this.viewAttempt(attempt) : null,
    };
  }

  public async getLogin(id: string, owner: BilibiliLoginOwner): Promise<BilibiliLoginAttempt> {
    const [row] = await this.database.orm
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.id, id),
          eq(attempts.adminUserId, owner.actorUserId),
          eq(attempts.clubSessionId, owner.clubSessionId),
        ),
      );
    if (!row) throw missingAttempt();
    if (row.expiresAt <= this.clock.now() && ACTIVE_STATES.includes(row.state)) {
      await this.finishAttempt(row.id, 'EXPIRED');
      return this.getLogin(id, owner);
    }
    return this.viewAttempt(row);
  }

  private async finishAttempt(
    id: string,
    state: 'CANCELLED' | 'EXPIRED' | 'FAILED',
    errorCode: string | null = null,
    operationId?: string,
  ): Promise<void> {
    await this.database.orm
      .update(attempts)
      .set({ ...clearedAttempt, state, errorCode, updatedAt: this.clock.now() })
      .where(
        and(
          eq(attempts.id, id),
          inArray(attempts.state, ACTIVE_STATES),
          operationId === undefined ? undefined : eq(attempts.operationId, operationId),
        ),
      );
  }

  public async createLogin(owner: BilibiliLoginOwner): Promise<BilibiliLoginAttempt> {
    const id = randomUUID();
    await this.database.orm.transaction(async (tx) => {
      await this.ownerIsValid(owner, tx);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('club:bilibili-login:' || ${owner.actorUserId}))`,
      );
      const row = await this.slot(tx);
      await tx
        .update(attempts)
        .set({ ...clearedAttempt, state: 'CANCELLED', updatedAt: this.clock.now() })
        .where(
          and(eq(attempts.adminUserId, owner.actorUserId), inArray(attempts.state, ACTIVE_STATES)),
        );
      await tx.insert(attempts).values({
        id,
        adminUserId: owner.actorUserId,
        clubSessionId: owner.clubSessionId,
        baseRevision: row.revision,
        expiresAt: this.future(180_000),
      });
      await this.audit.record(
        { ...owner, action: 'bilibili.login.created', targetId: id, targetType: 'bilibili_login' },
        tx,
      );
    });
    try {
      const qr = await this.request((signal) => this.passport.createLogin(signal));
      await this.database.orm
        .update(attempts)
        .set({
          state: 'WAITING',
          expiresAt: new Date(qr.expiresAt),
          qrContext: this.encryption.encrypt(qr, `bilibili:qr:${id}`),
          updatedAt: this.clock.now(),
          nextPollAt: this.clock.now(),
        })
        .where(
          and(
            eq(attempts.id, id),
            eq(attempts.state, 'CREATING'),
            gt(attempts.expiresAt, this.clock.now()),
          ),
        );
      this.demandChanged();
    } catch (error) {
      await this.finishAttempt(id, 'FAILED', this.errorCode(error));
      if (!(error instanceof BilibiliProviderError)) throw error;
    }
    return this.getLogin(id, owner);
  }

  public async cancelLogin(id: string, owner: BilibiliLoginOwner): Promise<void> {
    await this.database.orm.transaction(async (tx) => {
      await this.ownerIsValid(owner, tx);
      const row = await this.ownedAttempt(id, owner, tx);
      if (!ACTIVE_STATES.includes(row.state)) return;
      await tx
        .update(attempts)
        .set({ ...clearedAttempt, state: 'CANCELLED', updatedAt: this.clock.now() })
        .where(eq(attempts.id, id));
    });
  }

  public async activateLogin(
    id: string,
    owner: BilibiliLoginOwner,
  ): Promise<BilibiliSessionStatus> {
    const operationId = randomUUID();
    const candidate = await this.database.orm
      .transaction(async (tx) => {
        await this.ownerIsValid(owner, tx);
        const current = await this.slot(tx);
        const row = await this.ownedAttempt(id, owner, tx);
        if (row.state === 'APPLIED') return null;
        if (
          row.state !== 'READY' ||
          row.expiresAt <= this.clock.now() ||
          !row.candidateCredentials ||
          row.baseRevision !== current.revision
        )
          throw conflict();
        await tx
          .update(attempts)
          .set({
            state: 'ACTIVATING',
            operationId,
            operationExpiresAt: this.future(LEASE_MS),
            updatedAt: this.clock.now(),
          })
          .where(eq(attempts.id, id));
        return this.decrypt<BilibiliCredentials>(
          row.candidateCredentials,
          `bilibili:candidate:${id}`,
        );
      })
      .catch(async (error: unknown) => {
        if (
          error instanceof BilibiliProviderError &&
          error.code === 'BILIBILI_CREDENTIALS_UNREADABLE'
        ) {
          await this.finishAttempt(id, 'FAILED', error.code);
        }
        throw error;
      });
    if (!candidate) return this.status(owner);
    try {
      const checked = await this.request((signal) => this.passport.check(candidate, signal));
      await this.database.orm.transaction(async (tx) => {
        await this.ownerIsValid(owner, tx);
        const current = await this.slot(tx);
        const row = await this.ownedAttempt(id, owner, tx);
        if (
          row.state !== 'ACTIVATING' ||
          row.operationId !== operationId ||
          row.expiresAt <= this.clock.now() ||
          row.baseRevision !== current.revision
        )
          throw conflict();
        await tx
          .update(slots)
          .set({
            ...clearedOperation,
            revision: current.revision + 1,
            validity: 'VALID',
            reachability: 'HEALTHY',
            account: checked.account,
            credentials: this.encryption.encrypt(candidate, 'bilibili:active'),
            pendingCredentials: null,
            errorCode: null,
            checkedAt: this.clock.now(),
            loggedInAt: this.clock.now(),
            refreshedAt: null,
            nextCheckAt: checked.refreshRequired
              ? this.clock.now()
              : this.future(CHECK_INTERVAL_MS),
            updatedAt: this.clock.now(),
          })
          .where(eq(slots.id, 'global'));
        await tx
          .update(attempts)
          .set({
            ...clearedAttempt,
            state: 'APPLIED',
            errorCode: null,
            updatedAt: this.clock.now(),
          })
          .where(eq(attempts.id, id));
        await this.audit.record(
          {
            ...owner,
            action: 'bilibili.session.activated',
            targetType: 'bilibili_session',
            targetId: 'global',
            beforeSummary: { uid: current.account?.uid ?? null, revision: current.revision },
            afterSummary: { uid: checked.account.uid, revision: current.revision + 1 },
          },
          tx,
        );
      });
    } catch (error) {
      await this.database.orm
        .update(attempts)
        .set(
          error instanceof BilibiliProviderError && error.code !== 'BILIBILI_AUTH_REQUIRED'
            ? {
                state: 'READY',
                operationId: null,
                operationExpiresAt: null,
                errorCode: error.code,
                updatedAt: this.clock.now(),
              }
            : {
                ...clearedAttempt,
                state: 'FAILED',
                errorCode: error instanceof AppError ? error.code : 'BILIBILI_OPERATION_FAILED',
                updatedAt: this.clock.now(),
              },
        )
        .where(
          and(
            eq(attempts.id, id),
            eq(attempts.operationId, operationId),
            eq(attempts.state, 'ACTIVATING'),
          ),
        );
      throw error;
    }
    await this.publish();
    this.demandChanged();
    return this.status(owner);
  }

  public async requestCheck(owner: BilibiliLoginOwner): Promise<BilibiliSessionStatus> {
    await this.database.orm.transaction(async (tx) => {
      await this.ownerIsValid(owner, tx);
      const row = await this.slot(tx);
      if (row.credentials && row.validity !== 'REAUTH_REQUIRED') {
        await tx.update(slots).set({ nextCheckAt: this.clock.now() }).where(eq(slots.id, 'global'));
      }
    });
    this.demandChanged();
    return this.status(owner);
  }

  public async disconnect(
    revision: number,
    owner: BilibiliLoginOwner,
  ): Promise<BilibiliSessionStatus> {
    await this.database.orm.transaction(async (tx) => {
      await this.ownerIsValid(owner, tx);
      const row = await this.slot(tx);
      if (row.revision !== revision) throw conflict();
      await tx
        .update(slots)
        .set({
          ...clearedOperation,
          revision: row.revision + 1,
          validity: 'NOT_CONFIGURED',
          reachability: 'UNKNOWN',
          account: null,
          credentials: null,
          pendingCredentials: null,
          errorCode: null,
          nextCheckAt: null,
          checkedAt: null,
          loggedInAt: null,
          refreshedAt: null,
          updatedAt: this.clock.now(),
        })
        .where(eq(slots.id, 'global'));
      await tx
        .update(attempts)
        .set({ ...clearedAttempt, state: 'CANCELLED', updatedAt: this.clock.now() })
        .where(inArray(attempts.state, ACTIVE_STATES));
      await this.audit.record(
        {
          ...owner,
          action: 'bilibili.session.disconnected',
          targetType: 'bilibili_session',
          targetId: 'global',
          beforeSummary: { uid: row.account?.uid ?? null, revision: row.revision },
          afterSummary: { revision: row.revision + 1 },
        },
        tx,
      );
    });
    this.requestEpoch.abort();
    this.requestEpoch = new AbortController();
    await this.publish();
    return this.status(owner);
  }

  private async pollLogins(): Promise<void> {
    const now = this.clock.now();
    await this.database.orm
      .update(attempts)
      .set({ ...clearedAttempt, state: 'EXPIRED', updatedAt: now })
      .where(and(inArray(attempts.state, ACTIVE_STATES), lte(attempts.expiresAt, now)));
    // An interrupted activation has no upstream mutation. Its candidate can be checked again.
    await this.database.orm
      .update(attempts)
      .set({ state: 'READY', operationId: null, operationExpiresAt: null, updatedAt: now })
      .where(and(eq(attempts.state, 'ACTIVATING'), lte(attempts.operationExpiresAt, now)));
    const pending = await this.database.orm
      .select()
      .from(attempts)
      .where(
        and(
          inArray(attempts.state, ['WAITING', 'VERIFYING']),
          lte(attempts.nextPollAt, now),
          or(isNull(attempts.operationId), lte(attempts.operationExpiresAt, now)),
        ),
      )
      .orderBy(attempts.nextPollAt)
      .limit(20);
    for (const row of pending) {
      if (this.shutdown.signal.aborted) return;
      const operationId = randomUUID();
      const [claimed] = await this.database.orm
        .update(attempts)
        .set({ operationId, operationExpiresAt: this.future(LEASE_MS) })
        .where(
          and(
            eq(attempts.id, row.id),
            eq(attempts.state, row.state),
            gt(attempts.expiresAt, this.clock.now()),
            or(isNull(attempts.operationId), lte(attempts.operationExpiresAt, this.clock.now())),
          ),
        )
        .returning();
      if (!claimed) continue;
      const owned = () =>
        and(
          eq(attempts.id, row.id),
          eq(attempts.operationId, operationId),
          gt(attempts.expiresAt, this.clock.now()),
        );
      try {
        let credentials: BilibiliCredentials;
        if (claimed.candidateCredentials) {
          credentials = this.decrypt<BilibiliCredentials>(
            claimed.candidateCredentials,
            `bilibili:candidate:${row.id}`,
          );
        } else {
          if (!claimed.qrContext) throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
          const qr = this.decrypt<BilibiliQrLogin>(claimed.qrContext, `bilibili:qr:${row.id}`);
          const result = await this.request((signal) =>
            this.passport.pollLogin(qr.authCode, signal),
          );
          if (result.status === 'EXPIRED') {
            await this.finishAttempt(row.id, 'EXPIRED', null, operationId);
            continue;
          }
          if (result.status === 'WAITING') {
            await this.database.orm
              .update(attempts)
              .set({
                operationId: null,
                operationExpiresAt: null,
                nextPollAt: this.future(2000),
                errorCode: null,
              })
              .where(owned());
            continue;
          }
          credentials = result.credentials;
          const [saved] = await this.database.orm
            .update(attempts)
            .set({
              state: 'VERIFYING',
              qrContext: null,
              candidateCredentials: this.encryption.encrypt(
                credentials,
                `bilibili:candidate:${row.id}`,
              ),
              expiresAt: this.future(5 * 60_000),
            })
            .where(owned())
            .returning({ id: attempts.id });
          if (!saved) continue;
        }
        const checked = await this.request((signal) => this.passport.check(credentials, signal));
        await this.database.orm
          .update(attempts)
          .set({
            state: 'READY',
            account: checked.account,
            qrContext: null,
            operationId: null,
            operationExpiresAt: null,
            errorCode: null,
            updatedAt: this.clock.now(),
          })
          .where(
            and(
              eq(attempts.id, row.id),
              eq(attempts.operationId, operationId),
              gt(attempts.expiresAt, this.clock.now()),
            ),
          );
      } catch (error) {
        if (!(error instanceof BilibiliProviderError)) throw error;
        if (
          error.code === 'BILIBILI_AUTH_REQUIRED' ||
          error.code === 'BILIBILI_INVALID_RESPONSE' ||
          error.code === 'BILIBILI_CREDENTIALS_UNREADABLE'
        ) {
          await this.finishAttempt(row.id, 'FAILED', error.code, operationId);
        } else {
          await this.database.orm
            .update(attempts)
            .set({
              operationId: null,
              operationExpiresAt: null,
              errorCode: error.code,
              nextPollAt: this.future(5000),
              updatedAt: this.clock.now(),
            })
            .where(and(eq(attempts.id, row.id), eq(attempts.operationId, operationId)));
        }
      }
    }
    await this.database.orm
      .delete(attempts)
      .where(
        and(
          lt(attempts.expiresAt, this.future(-24 * 60 * 60_000)),
          inArray(attempts.state, ['APPLIED', 'CANCELLED', 'EXPIRED', 'FAILED']),
        ),
      );
  }

  private decrypt<T>(value: EncryptedValue, purpose: string): T {
    try {
      return this.encryption.decrypt<T>(value, purpose);
    } catch (error) {
      if (error instanceof EncryptionError)
        throw new BilibiliProviderError('BILIBILI_CREDENTIALS_UNREADABLE');
      throw error;
    }
  }

  private errorCode(error: unknown): string {
    return error instanceof BilibiliProviderError ? error.code : 'BILIBILI_OPERATION_FAILED';
  }

  private async maintainSession(): Promise<void> {
    const operationId = randomUUID();
    const claimed = await this.database.orm.transaction(async (tx) => {
      const row = await this.slot(tx);
      if (row.operationId && row.operationExpiresAt && row.operationExpiresAt > this.clock.now())
        return null;
      if (row.operation === 'REFRESHING') {
        // The prior process may have changed the upstream token without saving its response.
        // Replaying that external mutation cannot be made safe by a local transaction.
        await tx
          .update(slots)
          .set({
            ...clearedOperation,
            validity: 'REAUTH_REQUIRED',
            errorCode: 'BILIBILI_REFRESH_UNCERTAIN',
            nextCheckAt: null,
            updatedAt: this.clock.now(),
          })
          .where(eq(slots.id, 'global'));
        await this.audit.record(
          {
            actorUserId: null,
            action: 'bilibili.refresh.uncertain',
            targetType: 'bilibili_session',
            targetId: 'global',
            afterSummary: { revision: row.revision },
          },
          tx,
        );
        return null;
      }
      if (
        !row.credentials ||
        row.validity === 'REAUTH_REQUIRED' ||
        !row.nextCheckAt ||
        row.nextCheckAt > this.clock.now()
      )
        return null;
      const [updated] = await tx
        .update(slots)
        .set({
          operation: row.pendingCredentials ? 'VERIFYING' : 'CHECKING',
          operationId,
          operationExpiresAt: this.future(LEASE_MS),
          updatedAt: this.clock.now(),
        })
        .where(eq(slots.id, 'global'))
        .returning();
      return updated!;
    });
    if (!claimed) {
      await this.publish();
      return;
    }
    const owned = () =>
      and(
        eq(slots.id, 'global'),
        eq(slots.revision, claimed.revision),
        eq(slots.operationId, operationId),
      );
    try {
      if (claimed.pendingCredentials) {
        const pending = this.decrypt<BilibiliCredentials>(
          claimed.pendingCredentials,
          'bilibili:pending',
        );
        await this.activateRefresh(claimed, pending, operationId);
        return;
      }
      const credentials = this.decrypt<BilibiliCredentials>(
        claimed.credentials!,
        'bilibili:active',
      );
      const checked = await this.request((signal) => this.passport.check(credentials, signal));
      if (!checked.refreshRequired) {
        await this.database.orm
          .update(slots)
          .set({
            ...clearedOperation,
            account: checked.account,
            validity: 'VALID',
            reachability: 'HEALTHY',
            errorCode: null,
            checkedAt: this.clock.now(),
            nextCheckAt: this.future(CHECK_INTERVAL_MS),
            updatedAt: this.clock.now(),
          })
          .where(owned());
        return;
      }
      const [refreshing] = await this.database.orm
        .update(slots)
        .set({
          operation: 'REFRESHING',
          validity: 'CHECKING',
          operationExpiresAt: this.future(LEASE_MS),
          checkedAt: this.clock.now(),
        })
        .where(owned())
        .returning({ id: slots.id });
      if (!refreshing) return;
      await this.publish();
      const fresh = await this.request((signal) => this.passport.refresh(credentials, signal));
      // Persist the full response before any subsequent network request or publication.
      const [saved] = await this.database.orm
        .update(slots)
        .set({
          pendingCredentials: this.encryption.encrypt(fresh, 'bilibili:pending'),
          operation: 'VERIFYING',
          operationExpiresAt: this.future(LEASE_MS),
          updatedAt: this.clock.now(),
          nextCheckAt: this.clock.now(),
        })
        .where(owned())
        .returning({ id: slots.id });
      if (!saved) return;
      await this.activateRefresh(claimed, fresh, operationId);
    } catch (error) {
      if (!(error instanceof BilibiliProviderError)) throw error;
      const needsLogin =
        error.code === 'BILIBILI_AUTH_REQUIRED' ||
        error.code === 'BILIBILI_REFRESH_UNCERTAIN' ||
        error.code === 'BILIBILI_CREDENTIALS_UNREADABLE';
      await this.database.orm.transaction(async (tx) => {
        const [updated] = await tx
          .update(slots)
          .set({
            ...clearedOperation,
            ...(needsLogin
              ? { validity: 'REAUTH_REQUIRED' as const, pendingCredentials: null }
              : {}),
            reachability:
              error.code === 'BILIBILI_CREDENTIALS_UNREADABLE'
                ? claimed.reachability
                : error.code === 'BILIBILI_AUTH_REQUIRED'
                  ? 'HEALTHY'
                  : 'UNAVAILABLE',
            errorCode: error.code,
            nextCheckAt: needsLogin ? null : this.future(RETRY_MS),
            updatedAt: this.clock.now(),
          })
          .where(owned())
          .returning({ revision: slots.revision });
        if (updated && needsLogin)
          await this.audit.record(
            {
              actorUserId: null,
              action: 'bilibili.session.reauthentication_required',
              targetType: 'bilibili_session',
              targetId: 'global',
              afterSummary: { revision: updated.revision, errorCode: error.code },
            },
            tx,
          );
      });
    } finally {
      await this.publish();
    }
  }

  private async activateRefresh(
    claimed: Slot,
    credentials: BilibiliCredentials,
    operationId: string,
  ): Promise<void> {
    const checked = await this.request((signal) => this.passport.check(credentials, signal));
    await this.database.orm.transaction(async (tx) => {
      const [updated] = await tx
        .update(slots)
        .set({
          ...clearedOperation,
          revision: claimed.revision + 1,
          credentials: this.encryption.encrypt(credentials, 'bilibili:active'),
          pendingCredentials: null,
          account: checked.account,
          validity: 'VALID',
          reachability: 'HEALTHY',
          errorCode: null,
          checkedAt: this.clock.now(),
          refreshedAt: this.clock.now(),
          nextCheckAt: this.future(CHECK_INTERVAL_MS),
          updatedAt: this.clock.now(),
        })
        .where(
          and(
            eq(slots.id, 'global'),
            eq(slots.revision, claimed.revision),
            eq(slots.operationId, operationId),
            eq(slots.operation, 'VERIFYING'),
          ),
        )
        .returning({ revision: slots.revision });
      if (updated)
        await this.audit.record(
          {
            actorUserId: null,
            action: 'bilibili.session.refreshed',
            targetType: 'bilibili_session',
            targetId: 'global',
            afterSummary: { uid: checked.account.uid, revision: updated.revision },
          },
          tx,
        );
    });
  }

  public async tick(): Promise<void> {
    if (this.shutdown.signal.aborted) return;
    // Independent task groups: a slow QR poll must not block the session's due checks.
    const results = await Promise.allSettled([this.pollLogins(), this.maintainSession()]);
    for (const result of results)
      if (result.status === 'rejected' && !this.shutdown.signal.aborted) throw result.reason;
  }

  public beginShutdown(): void {
    this.shutdown.abort();
    this.active?.controller.abort();
    this.active = null;
  }

  public async close(): Promise<void> {
    this.beginShutdown();
    await Promise.allSettled([...this.network]);
  }
}
