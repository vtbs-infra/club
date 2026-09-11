import { createHash } from 'node:crypto';
import type { SessionStore } from '@fastify/session';
import type { Session } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { sessions, users } from '../../infrastructure/db/schema/index.js';

export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'club_session';
export function sessionDigest(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export function sessionData(session: Session): Record<string, unknown> {
  return {
    userId: session.userId,
    authVersion: session.authVersion,
    cookie: {
      expires: session.cookie.expires,
      originalMaxAge: null,
      path: session.cookie.path,
      httpOnly: session.cookie.httpOnly,
      secure: session.cookie.secure,
      sameSite: session.cookie.sameSite,
    },
  };
}

export class PostgresSessionStore implements SessionStore {
  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {}
  public get: SessionStore['get'] = (id, callback) => {
    void this.database.orm
      .select({ data: sessions.data })
      .from(sessions)
      .innerJoin(
        users,
        and(eq(users.id, sessions.userId), eq(users.authVersion, sessions.authVersion)),
      )
      .where(and(eq(sessions.id, sessionDigest(id)), gt(sessions.expiresAt, this.clock.now())))
      .limit(1)
      .then(([row]) => callback(null, row ? (row.data as unknown as Session) : null), callback);
  };
  public set: SessionStore['set'] = (id, session, callback) => {
    // Only the login transaction inserts. Late request saves must never resurrect a revoked session.
    if (!session.userId || !session.authVersion) {
      callback();
      return;
    }
    void this.database.orm
      .update(sessions)
      .set({ data: sessionData(session) })
      .where(
        and(
          eq(sessions.id, sessionDigest(id)),
          eq(sessions.userId, session.userId),
          eq(sessions.authVersion, session.authVersion),
          gt(sessions.expiresAt, this.clock.now()),
        ),
      )
      .then(() => callback(), callback);
  };
  public destroy: SessionStore['destroy'] = (id, callback) => {
    void this.database.orm
      .delete(sessions)
      .where(eq(sessions.id, sessionDigest(id)))
      .then(() => callback(), callback);
  };
}

declare module 'fastify' {
  interface Session {
    userId?: string;
    authVersion?: number;
  }
}
