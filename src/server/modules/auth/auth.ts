import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyBaseLogger,
  FastifyTypeProvider,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  RawServerBase,
} from 'fastify';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { AppConfig } from '../../config/env.js';
import { SystemClock, type Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import { passwordCredentials, sessions, users } from '../../infrastructure/db/schema/index.js';
import type { AuthUser } from '../../../shared/contracts/auth.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { hashPassword, normalizeName, normalizeUsername, verifyPassword } from './password.js';
import {
  PostgresSessionStore,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  sessionData,
  sessionDigest,
} from './session-store.js';

export type AuthSession = { user: AuthUser; session: { expiresAt: Date } };
export type AuthTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
export type StoredUser = typeof users.$inferSelect;
export function publicUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    bilibiliUid: user.bilibiliUid,
  };
}

export async function replacePassword(
  transaction: AuthTransaction,
  user: StoredUser,
  passwordHash: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(passwordCredentials)
    .set({ passwordHash, updatedAt: now })
    .where(eq(passwordCredentials.userId, user.id));
  await transaction
    .update(users)
    .set({ authVersion: user.authVersion + 1, updatedAt: now })
    .where(eq(users.id, user.id));
  await transaction.delete(sessions).where(eq(sessions.userId, user.id));
}

export class AuthService {
  public readonly store: PostgresSessionStore;
  public constructor(
    private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {
    this.store = new PostgresSessionStore(database, clock);
  }
  public async install<
    S extends RawServerBase,
    Q extends RawRequestDefaultExpression<S>,
    R extends RawReplyDefaultExpression<S>,
    L extends FastifyBaseLogger,
    P extends FastifyTypeProvider,
  >(app: FastifyInstance<S, Q, R, L, P>): Promise<void> {
    await app.register(fastifyCookie);
    await app.register(fastifySession, {
      secret: this.config.authSecret,
      cookieName: SESSION_COOKIE,
      store: this.store,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        path: '/',
        httpOnly: true,
        secure: this.config.nodeEnv === 'production',
        sameSite: 'lax',
      },
    });
  }
  public async getSession(request: Pick<FastifyRequest, 'session'>): Promise<AuthSession | null> {
    if (!request.session?.userId) return null;
    const [row] = await this.database.orm
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(
        users,
        and(eq(users.id, sessions.userId), eq(users.authVersion, sessions.authVersion)),
      )
      .where(
        and(
          eq(sessions.id, sessionDigest(request.session.sessionId)),
          gt(sessions.expiresAt, this.clock.now()),
        ),
      )
      .limit(1);
    return row ? { user: publicUser(row.user), session: { expiresAt: row.expiresAt } } : null;
  }
  public async login(
    request: FastifyRequest,
    username: string,
    password: string,
  ): Promise<AuthSession> {
    const [candidate] = await this.database.orm
      .select({ user: users, hash: passwordCredentials.passwordHash })
      .from(users)
      .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
      .where(eq(users.username, normalizeUsername(username)))
      .limit(1);
    if (!(await verifyPassword(password, candidate?.hash)) || !candidate) {
      throw new AppError('INVALID_CREDENTIALS', 'Username or password is incorrect.', 401);
    }
    const previousId = request.session.sessionId;
    await request.session.regenerate();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    const user = await this.database.orm.transaction(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, candidate.user.id))
        .for('update');
      if (!locked || locked.authVersion !== candidate.user.authVersion) {
        throw new AppError(
          'INVALID_CREDENTIALS',
          'Credentials changed. Please sign in again.',
          401,
        );
      }
      request.session.userId = locked.id;
      request.session.authVersion = locked.authVersion;
      request.session.cookie.expires = expiresAt;
      request.session.cookie.originalMaxAge = null;
      await transaction.delete(sessions).where(eq(sessions.id, sessionDigest(previousId)));
      await transaction.delete(sessions).where(lte(sessions.expiresAt, now));
      await transaction.insert(sessions).values({
        id: sessionDigest(request.session.sessionId),
        userId: locked.id,
        authVersion: locked.authVersion,
        data: sessionData(request.session),
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return locked;
    });
    return { user: publicUser(user), session: { expiresAt } };
  }
  public async changePassword(
    userId: string,
    currentPassword: string,
    password: string,
  ): Promise<void> {
    const [current] = await this.database.orm
      .select({ user: users, hash: passwordCredentials.passwordHash })
      .from(users)
      .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!current || !(await verifyPassword(currentPassword, current.hash)))
      throw new AppError('CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect.', 400);
    const hash = await hashPassword(password);
    await this.database.orm.transaction(async (transaction) => {
      const [user] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!user || user.authVersion !== current.user.authVersion)
        throw new AppError('CREDENTIALS_CHANGED', 'Credentials changed. Sign in again.', 409);
      await replacePassword(transaction, user, hash, this.clock.now());
    });
  }
  public async updateProfile(userId: string, name: string): Promise<AuthUser> {
    const [user] = await this.database.orm
      .update(users)
      .set({ name: normalizeName(name), updatedAt: this.clock.now() })
      .where(eq(users.id, userId))
      .returning();
    if (!user) throw new AppError('AUTHENTICATION_REQUIRED', 'Sign in is required.', 401);
    return publicUser(user);
  }
}
export type AppAuth = AuthService;
export function createAuth(options: {
  config: AppConfig;
  database: DatabaseService;
  clock?: Clock;
}): AppAuth {
  return new AuthService(options.config, options.database, options.clock ?? new SystemClock());
}
