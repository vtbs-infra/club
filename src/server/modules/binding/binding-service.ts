import { createHmac, randomBytes } from 'node:crypto';

import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  bindingChallenges,
  creators,
  verificationRooms,
} from '../../infrastructure/db/schema/index.js';
import { AuditService } from '../audit/audit-service.js';
import type { RequestAuditContext } from '../audit/audit-service.js';
import type { LiveMessageEvent } from '../bilibili/live-message-source.js';
import type { RoomConnectionManager } from '../bilibili/room-connection-manager.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHALLENGE_LIFETIME_MS = 10 * 60 * 1000;

export function generateBindingCode(): string {
  const bytes = randomBytes(6);
  const suffix = [...bytes].map((value) => CODE_ALPHABET[value & 31]).join('');
  return `CLUB-${suffix}`;
}

export function normalizeBindingCode(message: string): string | null {
  const candidate = message.trim().toUpperCase();
  return /^CLUB-[A-HJ-NP-Z2-9]{6}$/.test(candidate) ? candidate : null;
}

export function digestBindingCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(`club-binding-code:${code}`).digest('hex');
}

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? postgresErrorCode(error.cause) : null;
}

export type BindingMessageResult = 'BOUND' | 'CONFLICT' | 'DUPLICATE' | 'IGNORED';

export class BindingService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
    private readonly codeSecret: string,
    private readonly connections: RoomConnectionManager,
  ) {
    this.audit = new AuditService(database);
  }

  public async expireChallenges(): Promise<void> {
    await this.database.orm
      .update(bindingChallenges)
      .set({ status: 'EXPIRED', updatedAt: this.clock.now() })
      .where(
        and(
          eq(bindingChallenges.status, 'ACTIVE'),
          lte(bindingChallenges.expiresAt, this.clock.now()),
        ),
      );
  }

  public async reconcileConnections(): Promise<void> {
    await this.expireChallenges();
    const rooms = await this.database.orm
      .selectDistinct({ biliRoomId: verificationRooms.biliRoomId })
      .from(bindingChallenges)
      .innerJoin(verificationRooms, eq(verificationRooms.id, bindingChallenges.verificationRoomId))
      .where(
        and(
          eq(bindingChallenges.status, 'ACTIVE'),
          gt(bindingChallenges.expiresAt, this.clock.now()),
          eq(verificationRooms.enabled, true),
        ),
      );
    await this.connections.reconcile(rooms.map((room) => room.biliRoomId));
  }

  public async createChallenge(input: RequestAuditContext & { readonly userId: string }) {
    await this.expireChallenges();
    const [binding] = await this.database.orm
      .select({ id: bilibiliBindings.id })
      .from(bilibiliBindings)
      .where(and(eq(bilibiliBindings.userId, input.userId), isNull(bilibiliBindings.unboundAt)))
      .limit(1);
    if (binding) {
      throw new AppError(
        'BILIBILI_BINDING_EXISTS',
        'Unbind the current UID before rebinding.',
        409,
      );
    }

    const [room] = await this.database.orm
      .select()
      .from(verificationRooms)
      .where(eq(verificationRooms.enabled, true))
      .orderBy(
        sql`case when ${verificationRooms.healthStatus} = 'HEALTHY' then 0 else 1 end`,
        asc(verificationRooms.priority),
      )
      .limit(1);
    if (!room) {
      throw new AppError(
        'VERIFICATION_ROOM_UNAVAILABLE',
        'No verification room is currently enabled.',
        503,
      );
    }

    const code = generateBindingCode();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + CHALLENGE_LIFETIME_MS);
    const challenge = await this.database.orm.transaction(async (transaction) => {
      await transaction
        .update(bindingChallenges)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(
          and(eq(bindingChallenges.userId, input.userId), eq(bindingChallenges.status, 'ACTIVE')),
        );
      const [created] = await transaction
        .insert(bindingChallenges)
        .values({
          codeDigest: digestBindingCode(code, this.codeSecret),
          expiresAt,
          userId: input.userId,
          verificationRoomId: room.id,
        })
        .returning();
      if (!created) throw new Error('Binding-challenge insert returned no row.');
      await this.audit.record(
        {
          action: 'bilibili-binding.challenge-created',
          actorUserId: input.actorUserId,
          afterSummary: { expiresAt: expiresAt.toISOString(), verificationRoomId: room.id },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: created.id,
          targetType: 'binding-challenge',
        },
        transaction,
      );
      return created;
    });
    await this.reconcileConnections();
    return {
      code,
      expiresAt: challenge.expiresAt,
      id: challenge.id,
      room: {
        displayName: room.displayName,
        id: room.id,
        link: `https://live.bilibili.com/${room.biliRoomId}`,
      },
    };
  }

  public async getAccountState(userId: string) {
    await this.expireChallenges();
    const [binding] = await this.database.orm
      .select({
        biliDisplayName: bilibiliBindings.biliDisplayName,
        biliUid: bilibiliBindings.biliUid,
        boundAt: bilibiliBindings.boundAt,
        id: bilibiliBindings.id,
      })
      .from(bilibiliBindings)
      .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
      .limit(1);
    const [challenge] = await this.database.orm
      .select({
        expiresAt: bindingChallenges.expiresAt,
        id: bindingChallenges.id,
        roomDisplayName: verificationRooms.displayName,
        roomId: verificationRooms.biliRoomId,
        status: bindingChallenges.status,
      })
      .from(bindingChallenges)
      .innerJoin(verificationRooms, eq(verificationRooms.id, bindingChallenges.verificationRoomId))
      .where(eq(bindingChallenges.userId, userId))
      .orderBy(desc(bindingChallenges.createdAt))
      .limit(1);
    return {
      binding: binding ?? null,
      challenge: challenge
        ? {
            connectionState: this.connections.getState(challenge.roomId),
            expiresAt: challenge.expiresAt,
            id: challenge.id,
            room: {
              displayName: challenge.roomDisplayName,
              link: `https://live.bilibili.com/${challenge.roomId}`,
            },
            status: challenge.status,
          }
        : null,
    };
  }

  private async recordConflict(
    challengeId: string,
    event: LiveMessageEvent,
    userId: string,
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(bindingChallenges)
        .set({
          consumedAt: this.clock.now(),
          consumedEventId: event.eventId,
          status: 'CONFLICT',
          updatedAt: this.clock.now(),
        })
        .where(and(eq(bindingChallenges.id, challengeId), eq(bindingChallenges.status, 'ACTIVE')))
        .returning({ id: bindingChallenges.id });
      if (!updated) return;
      await this.audit.record(
        {
          action: 'bilibili-binding.conflict',
          actorUserId: userId,
          afterSummary: { biliUid: event.biliUid, eventId: event.eventId },
          targetId: challengeId,
          targetType: 'binding-challenge',
        },
        transaction,
      );
    });
  }

  public async handleLiveMessage(event: LiveMessageEvent): Promise<BindingMessageResult> {
    const code = normalizeBindingCode(event.message);
    if (!code) return 'IGNORED';
    const [processed] = await this.database.orm
      .select({ id: bindingChallenges.id })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.consumedEventId, event.eventId))
      .limit(1);
    if (processed) return 'DUPLICATE';

    let matchedChallengeId: string | null = null;
    let matchedUserId: string | null = null;
    try {
      const result = await this.database.orm.transaction(async (transaction) => {
        const [challenge] = await transaction
          .select({ id: bindingChallenges.id, userId: bindingChallenges.userId })
          .from(bindingChallenges)
          .innerJoin(
            verificationRooms,
            eq(verificationRooms.id, bindingChallenges.verificationRoomId),
          )
          .where(
            and(
              eq(bindingChallenges.codeDigest, digestBindingCode(code, this.codeSecret)),
              eq(bindingChallenges.status, 'ACTIVE'),
              // The recent-message endpoint reports whole seconds, so allow the remainder of
              // that second while still rejecting messages from before challenge creation.
              lte(bindingChallenges.createdAt, new Date(event.occurredAt.getTime() + 1_000)),
              gt(bindingChallenges.expiresAt, this.clock.now()),
              eq(verificationRooms.biliRoomId, event.roomId),
            ),
          )
          .limit(1)
          .for('update');
        if (!challenge) return 'IGNORED' as const;
        matchedChallengeId = challenge.id;
        matchedUserId = challenge.userId;

        const [conflicting] = await transaction
          .select({ id: bilibiliBindings.id })
          .from(bilibiliBindings)
          .where(
            and(
              isNull(bilibiliBindings.unboundAt),
              or(
                eq(bilibiliBindings.userId, challenge.userId),
                eq(bilibiliBindings.biliUid, event.biliUid),
              ),
            ),
          )
          .limit(1);
        if (conflicting) {
          await transaction
            .update(bindingChallenges)
            .set({
              consumedAt: this.clock.now(),
              consumedEventId: event.eventId,
              status: 'CONFLICT',
              updatedAt: this.clock.now(),
            })
            .where(eq(bindingChallenges.id, challenge.id));
          await this.audit.record(
            {
              action: 'bilibili-binding.conflict',
              actorUserId: challenge.userId,
              afterSummary: { biliUid: event.biliUid, eventId: event.eventId },
              targetId: challenge.id,
              targetType: 'binding-challenge',
            },
            transaction,
          );
          return 'CONFLICT' as const;
        }

        const [binding] = await transaction
          .insert(bilibiliBindings)
          .values({
            biliDisplayName: event.biliDisplayName,
            biliUid: event.biliUid,
            challengeId: challenge.id,
            userId: challenge.userId,
          })
          .returning();
        if (!binding) throw new Error('Bilibili-binding insert returned no row.');
        await transaction
          .update(bindingChallenges)
          .set({
            consumedAt: this.clock.now(),
            consumedEventId: event.eventId,
            status: 'CONSUMED',
            updatedAt: this.clock.now(),
          })
          .where(eq(bindingChallenges.id, challenge.id));
        await this.audit.record(
          {
            action: 'bilibili-binding.created',
            actorUserId: challenge.userId,
            afterSummary: { biliUid: event.biliUid, eventId: event.eventId },
            targetId: binding.id,
            targetType: 'bilibili-binding',
          },
          transaction,
        );
        return 'BOUND' as const;
      });
      if (result !== 'IGNORED') await this.reconcileConnections();
      return result;
    } catch (error) {
      if (
        postgresErrorCode(error) !== '23505' ||
        matchedChallengeId === null ||
        matchedUserId === null
      ) {
        throw error;
      }
      const [duplicate] = await this.database.orm
        .select({ id: bindingChallenges.id })
        .from(bindingChallenges)
        .where(eq(bindingChallenges.consumedEventId, event.eventId))
        .limit(1);
      if (duplicate) return 'DUPLICATE';
      await this.recordConflict(matchedChallengeId, event, matchedUserId);
      await this.reconcileConnections();
      return 'CONFLICT';
    }
  }

  public async unbind(input: RequestAuditContext & { readonly userId: string }): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const [binding] = await transaction
        .select()
        .from(bilibiliBindings)
        .where(and(eq(bilibiliBindings.userId, input.userId), isNull(bilibiliBindings.unboundAt)))
        .limit(1)
        .for('update');
      if (!binding) {
        throw new AppError('BILIBILI_BINDING_NOT_FOUND', 'No active Bilibili binding exists.', 404);
      }
      const [creator] = await transaction
        .select({ id: creators.id })
        .from(creators)
        .where(eq(creators.bindingId, binding.id))
        .limit(1);
      if (creator) {
        throw new AppError(
          'CREATOR_BILIBILI_BINDING_IMMUTABLE',
          'A creator account cannot replace its verified Bilibili identity.',
          409,
        );
      }
      await transaction
        .update(bilibiliBindings)
        .set({ unboundAt: this.clock.now(), updatedAt: this.clock.now() })
        .where(eq(bilibiliBindings.id, binding.id));
      await this.audit.record(
        {
          action: 'bilibili-binding.removed',
          actorUserId: input.actorUserId,
          beforeSummary: { biliUid: binding.biliUid },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: binding.id,
          targetType: 'bilibili-binding',
        },
        transaction,
      );
    });
  }

  public async administrativeUnbind(
    input: RequestAuditContext & { readonly bindingId: string; readonly reason: string },
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const [binding] = await transaction
        .select()
        .from(bilibiliBindings)
        .where(and(eq(bilibiliBindings.id, input.bindingId), isNull(bilibiliBindings.unboundAt)))
        .limit(1)
        .for('update');
      if (!binding) {
        throw new AppError('BILIBILI_BINDING_NOT_FOUND', 'No active Bilibili binding exists.', 404);
      }
      const [creator] = await transaction
        .select({ id: creators.id })
        .from(creators)
        .where(eq(creators.bindingId, binding.id))
        .limit(1);
      if (creator) {
        throw new AppError(
          'CREATOR_BILIBILI_BINDING_IMMUTABLE',
          'A creator account cannot replace its verified Bilibili identity.',
          409,
        );
      }
      await transaction
        .update(bilibiliBindings)
        .set({ unboundAt: this.clock.now(), updatedAt: this.clock.now() })
        .where(eq(bilibiliBindings.id, binding.id));
      await this.audit.record(
        {
          action: 'bilibili-binding.administrator-removed',
          actorUserId: input.actorUserId,
          beforeSummary: { biliUid: binding.biliUid, userId: binding.userId },
          ipAddress: input.ipAddress,
          reason: input.reason,
          requestId: input.requestId,
          targetId: binding.id,
          targetType: 'bilibili-binding',
        },
        transaction,
      );
    });
  }
}
