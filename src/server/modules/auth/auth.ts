import { createHash, randomBytes } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import type {
  FastifyInstance,
  FastifyReply,
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
import { AuditService } from '../audit/audit-service.js';
import { hashPassword, normalizeName, normalizeUsername, verifyPassword } from './password.js';

/**
 * A session row is written once at login and only deleted afterwards, so a request still
 * running during a logout or password change has nothing it could write back.
 */
export const SESSION_COOKIE = 'club_session';
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
type SessionRequest = Pick<FastifyRequest, 'cookies' | 'unsignCookie'>;

/** Rows are keyed by a digest, so the database never holds a usable token. */
function sessionDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The stored id behind the browser's signed session cookie, whether or not the row still exists. */
export function requestSessionId(request: SessionRequest): string | null {
  const cookie = request.cookies[SESSION_COOKIE];
  if (!cookie) return null;
  const { valid, value } = request.unsignCookie(cookie);
  return valid ? sessionDigest(value) : null;
}

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
  public constructor(
    private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {}
  public async install<
    S extends RawServerBase,
    Q extends RawRequestDefaultExpression<S>,
    R extends RawReplyDefaultExpression<S>,
    L extends FastifyBaseLogger,
    P extends FastifyTypeProvider,
  >(app: FastifyInstance<S, Q, R, L, P>): Promise<void> {
    await app.register(fastifyCookie, { secret: this.config.authSecret });
  }
  public async getSession(request: SessionRequest): Promise<AuthSession | null> {
    const id = requestSessionId(request);
    if (!id) return null;
    const [row] = await this.database.orm
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(
        users,
        and(eq(users.id, sessions.userId), eq(users.authVersion, sessions.authVersion)),
      )
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, this.clock.now())))
      .limit(1);
    return row ? { user: publicUser(row.user), session: { expiresAt: row.expiresAt } } : null;
  }
  public async login(
    request: FastifyRequest,
    reply: FastifyReply,
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
    const previous = requestSessionId(request);
    const token = randomBytes(32).toString('base64url');
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
      if (previous) await transaction.delete(sessions).where(eq(sessions.id, previous));
      await transaction.delete(sessions).where(lte(sessions.expiresAt, now));
      await transaction.insert(sessions).values({
        id: sessionDigest(token),
        userId: locked.id,
        authVersion: locked.authVersion,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return locked;
    });
    void reply.setCookie(SESSION_COOKIE, token, {
      expires: expiresAt,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.config.nodeEnv === 'production',
      signed: true,
    });
    return { user: publicUser(user), session: { expiresAt } };
  }
  /** Ends the browser's current session; other sessions of the account stay valid. */
  public async endSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const id = requestSessionId(request);
    if (id) await this.database.orm.delete(sessions).where(eq(sessions.id, id));
    request.authSession = null;
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
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
      await new AuditService(this.database).record(
        {
          action: 'auth.password-changed',
          actorUserId: user.id,
          targetId: user.id,
          targetType: 'user',
        },
        transaction,
      );
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
