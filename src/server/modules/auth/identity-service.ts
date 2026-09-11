import { createHmac, randomInt } from 'node:crypto';
import { and, asc, count, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { ChallengePurpose, CreateChallengeBody } from '../../../shared/contracts/auth.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { isUniqueViolation } from '../../infrastructure/db/errors.js';
import {
  identityChallenges,
  passwordCredentials,
  users,
  verificationRooms,
} from '../../infrastructure/db/schema/index.js';
import type { LiveMessageEvent } from '../bilibili/live-message-source.js';
import type { RoomConnectionManager } from '../bilibili/room-connection-manager.js';
import { publicUser, replacePassword, type AuthTransaction } from './auth.js';
import { hashPassword, normalizeName, normalizeUsername } from './password.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIFETIME = 10 * 60_000;
export const CHALLENGE_COOKIE = 'club_identity';
type Challenge = typeof identityChallenges.$inferSelect;

export function generateIdentityCode(): string {
  return (
    'CLUB-' +
    Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
  );
}
export function normalizeIdentityCode(message: string): string | null {
  const candidate = message.trim().toUpperCase();
  return /^CLUB-[A-HJ-NP-Z2-9]{10}$/.test(candidate) ? candidate : null;
}
export function digestIdentityCode(code: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('club-identity-code:' + code)
    .digest('hex');
}

export class IdentityService {
  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
    private readonly secret: string,
    private readonly connections: RoomConnectionManager,
    private readonly demandChanged: () => void,
  ) {}
  private ownerDigest(owner: string): string {
    return createHmac('sha256', this.secret)
      .update('club-identity-owner:' + owner)
      .digest('hex');
  }
  private validProof(
    challenge: Challenge | undefined,
    owner: string,
    purpose: ChallengePurpose,
  ): asserts challenge is Challenge & { verifiedUid: string } {
    if (
      !challenge ||
      challenge.ownerDigest !== this.ownerDigest(owner) ||
      challenge.purpose !== purpose ||
      challenge.status !== 'VERIFIED' ||
      !challenge.verifiedUid ||
      challenge.expiresAt <= this.clock.now()
    ) {
      throw new AppError(
        'IDENTITY_PROOF_INVALID',
        'Complete a new identity verification in this browser.',
        409,
      );
    }
  }
  private async proof(
    id: string,
    owner: string,
    purpose: ChallengePurpose,
    transaction?: AuthTransaction,
  ) {
    const query = (transaction ?? this.database.orm)
      .select()
      .from(identityChallenges)
      .where(eq(identityChallenges.id, id))
      .limit(1);
    const [challenge] = await (transaction ? query.for('update') : query);
    this.validProof(challenge, owner, purpose);
    return challenge;
  }
  public async expireChallenges(now = this.clock.now()): Promise<void> {
    await this.database.orm
      .update(identityChallenges)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(
        and(
          inArray(identityChallenges.status, ['PENDING', 'VERIFIED']),
          lte(identityChallenges.expiresAt, now),
        ),
      );
    await this.database.orm
      .delete(identityChallenges)
      .where(lte(identityChallenges.expiresAt, new Date(now.getTime() - 24 * 60 * 60_000)));
  }
  public async reconcileConnections(): Promise<void> {
    await this.expireChallenges();
    const rooms = await this.database.orm
      .selectDistinct({ biliRoomId: verificationRooms.biliRoomId })
      .from(identityChallenges)
      .innerJoin(verificationRooms, eq(verificationRooms.id, identityChallenges.verificationRoomId))
      .where(
        and(
          eq(identityChallenges.status, 'PENDING'),
          gt(identityChallenges.expiresAt, this.clock.now()),
          eq(verificationRooms.enabled, true),
        ),
      );
    await this.connections.reconcile(rooms.map((room) => room.biliRoomId));
  }
  public async createChallenge(owner: string, input: CreateChallengeBody) {
    const now = this.clock.now();
    const code = generateIdentityCode();
    const created = await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext('club:identity-challenges'))`,
      );
      await transaction
        .delete(identityChallenges)
        .where(lte(identityChallenges.expiresAt, new Date(now.getTime() - 24 * 60 * 60_000)));
      const [total] = await transaction.select({ value: count() }).from(identityChallenges);
      if ((total?.value ?? 0) >= 5000) throw new AppError('IDENTITY_BUSY', 'Try again later.', 429);
      const [room] = await transaction
        .select()
        .from(verificationRooms)
        .where(eq(verificationRooms.enabled, true))
        .orderBy(
          sql`case when ${verificationRooms.healthStatus} = 'HEALTHY' then 0 else 1 end`,
          asc(verificationRooms.priority),
        )
        .limit(1);
      if (!room)
        throw new AppError(
          'VERIFICATION_ROOM_UNAVAILABLE',
          'No verification room is available.',
          503,
        );
      const [target] =
        input.purpose === 'RECOVER'
          ? await transaction
              .select()
              .from(users)
              .where(eq(users.bilibiliUid, input.biliUid))
              .limit(1)
          : [];
      await transaction
        .update(identityChallenges)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(
          and(
            eq(identityChallenges.ownerDigest, this.ownerDigest(owner)),
            inArray(identityChallenges.status, ['PENDING', 'VERIFIED']),
          ),
        );
      const [challenge] = await transaction
        .insert(identityChallenges)
        .values({
          ownerDigest: this.ownerDigest(owner),
          purpose: input.purpose,
          verificationRoomId: room.id,
          codeDigest: digestIdentityCode(code, this.secret),
          expiresAt: new Date(now.getTime() + LIFETIME),
          expectedUid: input.purpose === 'RECOVER' ? input.biliUid : null,
          expectedUserId: target?.id ?? null,
          expectedAuthVersion: target?.authVersion ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!challenge) throw new Error('Identity challenge insert returned no row.');
      return challenge;
    });
    this.demandChanged();
    return { ...(await this.getChallenge(created.id, owner)), code };
  }
  public async getChallenge(id: string, owner: string) {
    const [row] = await this.database.orm
      .select({ challenge: identityChallenges, room: verificationRooms })
      .from(identityChallenges)
      .innerJoin(verificationRooms, eq(verificationRooms.id, identityChallenges.verificationRoomId))
      .where(
        and(
          eq(identityChallenges.id, id),
          eq(identityChallenges.ownerDigest, this.ownerDigest(owner)),
        ),
      )
      .limit(1);
    if (!row)
      throw new AppError(
        'IDENTITY_CHALLENGE_NOT_FOUND',
        'Challenge not found in this browser.',
        404,
      );
    const { challenge, room } = row;
    const expired =
      ['PENDING', 'VERIFIED'].includes(challenge.status) && challenge.expiresAt <= this.clock.now();
    const status = expired ? ('EXPIRED' as const) : challenge.status;
    let username: string | null = null;
    if (status === 'VERIFIED' && challenge.purpose === 'RECOVER' && challenge.expectedUserId) {
      const [user] = await this.database.orm
        .select()
        .from(users)
        .where(eq(users.id, challenge.expectedUserId))
        .limit(1);
      if (
        user &&
        user.bilibiliUid === challenge.verifiedUid &&
        user.authVersion === challenge.expectedAuthVersion
      )
        username = user.username;
    }
    return {
      id,
      purpose: challenge.purpose,
      status,
      expiresAt: challenge.expiresAt,
      room: { displayName: room.displayName, link: 'https://live.bilibili.com/' + room.biliRoomId },
      connectionState: status === 'PENDING' ? this.connections.getState(room.biliRoomId) : null,
      biliUid: status === 'VERIFIED' ? challenge.verifiedUid : null,
      username,
    };
  }
  public async handleLiveMessage(
    event: LiveMessageEvent,
  ): Promise<'VERIFIED' | 'DUPLICATE' | 'IGNORED'> {
    const code = normalizeIdentityCode(event.message);
    const now = this.clock.now();
    if (
      !code ||
      !/^[1-9][0-9]{0,19}$/.test(event.biliUid) ||
      !event.eventId ||
      !Number.isFinite(event.occurredAt.getTime()) ||
      event.occurredAt.getTime() > now.getTime() + 1000
    )
      return 'IGNORED';
    let result: 'VERIFIED' | 'DUPLICATE' | 'IGNORED';
    try {
      result = await this.database.orm.transaction(async (transaction) => {
        const [duplicate] = await transaction
          .select({ id: identityChallenges.id })
          .from(identityChallenges)
          .where(eq(identityChallenges.eventId, event.eventId))
          .limit(1);
        if (duplicate) return 'DUPLICATE' as const;
        const [row] = await transaction
          .select({ challenge: identityChallenges })
          .from(identityChallenges)
          .innerJoin(
            verificationRooms,
            eq(verificationRooms.id, identityChallenges.verificationRoomId),
          )
          .where(
            and(
              eq(identityChallenges.codeDigest, digestIdentityCode(code, this.secret)),
              eq(identityChallenges.status, 'PENDING'),
              gt(identityChallenges.expiresAt, now),
              eq(verificationRooms.biliRoomId, event.roomId),
              eq(verificationRooms.enabled, true),
            ),
          )
          .limit(1)
          .for('update');
        const challenge = row?.challenge;
        if (
          !challenge ||
          event.occurredAt.getTime() < challenge.createdAt.getTime() - 1000 ||
          (challenge.purpose === 'RECOVER' && challenge.expectedUid !== event.biliUid)
        )
          return 'IGNORED' as const;
        await transaction
          .update(identityChallenges)
          .set({
            status: 'VERIFIED',
            verifiedUid: event.biliUid,
            verifiedAt: now,
            eventId: event.eventId,
            expiresAt: new Date(now.getTime() + LIFETIME),
            updatedAt: now,
          })
          .where(eq(identityChallenges.id, challenge.id));
        return 'VERIFIED' as const;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return 'DUPLICATE';
    }
    if (result === 'VERIFIED') this.demandChanged();
    return result;
  }
  public async register(
    owner: string,
    input: { challengeId: string; username: string; name: string; password: string },
  ) {
    const proof = await this.proof(input.challengeId, owner, 'REGISTER');
    const username = normalizeUsername(input.username);
    const name = normalizeName(input.name);
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.database.orm.transaction(async (transaction) => {
        const challenge = await this.proof(input.challengeId, owner, 'REGISTER', transaction);
        const [user] = await transaction
          .insert(users)
          .values({ username, name, bilibiliUid: challenge.verifiedUid })
          .returning();
        if (!user) throw new Error('Account insert returned no row.');
        await transaction.insert(passwordCredentials).values({ userId: user.id, passwordHash });
        await transaction
          .update(identityChallenges)
          .set({ status: 'CONSUMED', updatedAt: this.clock.now() })
          .where(eq(identityChallenges.id, challenge.id));
        return publicUser(user);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [existing] = await this.database.orm
        .select({ id: users.id })
        .from(users)
        .where(eq(users.bilibiliUid, proof.verifiedUid))
        .limit(1);
      throw existing
        ? new AppError(
            'UID_ALREADY_REGISTERED',
            'This Bilibili account is registered. Sign in or recover it.',
            409,
          )
        : new AppError('USERNAME_TAKEN', 'Choose another username.', 409);
    }
  }
  public async recover(owner: string, challengeId: string, password: string): Promise<void> {
    await this.proof(challengeId, owner, 'RECOVER');
    const passwordHash = await hashPassword(password);
    await this.database.orm.transaction(async (transaction) => {
      const challenge = await this.proof(challengeId, owner, 'RECOVER', transaction);
      const [user] = challenge.expectedUserId
        ? await transaction
            .select()
            .from(users)
            .where(eq(users.id, challenge.expectedUserId))
            .for('update')
        : [];
      if (
        !user ||
        user.bilibiliUid !== challenge.verifiedUid ||
        user.authVersion !== challenge.expectedAuthVersion
      ) {
        throw new AppError(
          'RECOVERY_PROOF_STALE',
          'Account unavailable or credentials changed. Start again.',
          409,
        );
      }
      await replacePassword(transaction, user, passwordHash, this.clock.now());
      await transaction
        .update(identityChallenges)
        .set({ status: 'CONSUMED', updatedAt: this.clock.now() })
        .where(eq(identityChallenges.id, challenge.id));
    });
  }
}
