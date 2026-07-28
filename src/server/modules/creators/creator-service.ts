import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { creators, users } from '../../infrastructure/db/schema.js';
import { normalizeIanaTimezone } from '../snapshots/month-end.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

export interface CreateCreatorInput extends RequestAuditContext {
  readonly bilibiliUid: string;
  readonly displayName: string;
  readonly roomId: string;
  readonly timezone: string;
  readonly userId: string;
}

export interface UpdateCreatorInput extends RequestAuditContext {
  readonly active?: boolean;
  readonly bilibiliUid?: string;
  readonly creatorId: string;
  readonly displayName?: string;
  readonly roomId?: string;
  readonly timezone?: string;
}

function uniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && uniqueViolation(error.cause);
}

function normalizeIdentity(input: {
  readonly bilibiliUid: string;
  readonly displayName: string;
  readonly roomId: string;
  readonly timezone: string;
}) {
  const bilibiliUid = input.bilibiliUid.trim();
  const roomId = input.roomId.trim();
  const displayName = input.displayName.trim();
  if (!/^[0-9]{1,32}$/.test(bilibiliUid) || !/^[0-9]{1,32}$/.test(roomId)) {
    throw new AppError(
      'CREATOR_BILIBILI_IDENTITY_INVALID',
      'Bilibili UID and room ID must contain only digits.',
      400,
    );
  }
  if (!displayName || displayName.length > 120) {
    throw new AppError('CREATOR_NAME_INVALID', 'Creator display name is invalid.', 400);
  }
  let timezone: string;
  try {
    timezone = normalizeIanaTimezone(input.timezone);
  } catch {
    throw new AppError('CREATOR_TIMEZONE_INVALID', 'A valid IANA timezone is required.', 400);
  }
  return { bilibiliUid, displayName, roomId, timezone };
}

export class CreatorService {
  private readonly audit: AuditService;

  public constructor(private readonly database: DatabaseService) {
    this.audit = new AuditService(database);
  }

  public async getIdentity(userId: string) {
    const [user] = await this.database.orm
      .select({
        email: users.email,
        id: users.id,
        image: users.image,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new AppError('USER_NOT_FOUND', 'User account not found.', 404);
    const [creator] =
      user.role === 'CREATOR'
        ? await this.database.orm
            .select({
              active: creators.active,
              bilibiliUid: creators.bilibiliUid,
              displayName: creators.displayName,
              id: creators.id,
              roomId: creators.roomId,
              timezone: creators.timezone,
            })
            .from(creators)
            .where(and(eq(creators.userId, user.id), isNull(creators.archivedAt)))
            .limit(1)
        : [];
    return { creator: creator ?? null, user };
  }

  public async listUsers(search = '') {
    const normalized = search.trim();
    return this.database.orm
      .select({
        email: users.email,
        id: users.id,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(
        normalized
          ? or(ilike(users.email, `%${normalized}%`), ilike(users.name, `%${normalized}%`))
          : undefined,
      )
      .orderBy(asc(users.name))
      .limit(100);
  }

  public listCreators() {
    return this.database.orm
      .select({
        active: creators.active,
        archivedAt: creators.archivedAt,
        bilibiliUid: creators.bilibiliUid,
        createdAt: creators.createdAt,
        displayName: creators.displayName,
        email: users.email,
        id: creators.id,
        roomId: creators.roomId,
        timezone: creators.timezone,
        userId: creators.userId,
        userName: users.name,
      })
      .from(creators)
      .innerJoin(users, eq(users.id, creators.userId))
      .orderBy(asc(creators.displayName));
  }

  public async create(input: CreateCreatorInput) {
    const identity = normalizeIdentity(input);
    try {
      return await this.database.orm.transaction(async (transaction) => {
        const [account] = await transaction
          .select({ email: users.email, id: users.id, name: users.name, role: users.role })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
          .for('update');
        if (!account) throw new AppError('USER_NOT_FOUND', 'User account not found.', 404);
        if (account.role !== 'USER') {
          throw new AppError(
            'CREATOR_PROMOTION_NOT_ALLOWED',
            'Only an ordinary user can be promoted to creator.',
            409,
          );
        }
        const now = new Date();
        const [creator] = await transaction
          .insert(creators)
          .values({
            ...identity,
            userId: account.id,
          })
          .returning();
        if (!creator) throw new Error('Creator insert returned no row.');
        await transaction
          .update(users)
          .set({ role: 'CREATOR', updatedAt: now })
          .where(eq(users.id, account.id));
        await this.audit.record(
          {
            action: 'creator.created',
            actorUserId: input.actorUserId,
            afterSummary: {
              bilibiliUid: creator.bilibiliUid,
              displayName: creator.displayName,
              roomId: creator.roomId,
              timezone: creator.timezone,
              userId: creator.userId,
            },
            creatorId: creator.id,
            ipAddress: input.ipAddress,
            requestId: input.requestId,
            targetId: creator.id,
            targetType: 'creator',
          },
          transaction,
        );
        return { ...creator, email: account.email, userName: account.name };
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new AppError(
          'CREATOR_IDENTITY_CONFLICT',
          'This account, Bilibili UID, or room is already assigned.',
          409,
        );
      }
      throw error;
    }
  }

  public async update(input: UpdateCreatorInput) {
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(creators)
        .where(eq(creators.id, input.creatorId))
        .limit(1)
        .for('update');
      if (!before) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
      const identity = normalizeIdentity({
        bilibiliUid: input.bilibiliUid ?? before.bilibiliUid,
        displayName: input.displayName ?? before.displayName,
        roomId: input.roomId ?? before.roomId,
        timezone: input.timezone ?? before.timezone,
      });
      try {
        const [updated] = await transaction
          .update(creators)
          .set({
            ...identity,
            active: input.active ?? before.active,
            updatedAt: new Date(),
          })
          .where(eq(creators.id, before.id))
          .returning();
        if (!updated) throw new Error('Creator update returned no row.');
        await this.audit.record(
          {
            action: 'creator.updated',
            actorUserId: input.actorUserId,
            afterSummary: {
              active: updated.active,
              bilibiliUid: updated.bilibiliUid,
              displayName: updated.displayName,
              roomId: updated.roomId,
              timezone: updated.timezone,
            },
            beforeSummary: {
              active: before.active,
              bilibiliUid: before.bilibiliUid,
              displayName: before.displayName,
              roomId: before.roomId,
              timezone: before.timezone,
            },
            creatorId: updated.id,
            ipAddress: input.ipAddress,
            requestId: input.requestId,
            targetId: updated.id,
            targetType: 'creator',
          },
          transaction,
        );
        return updated;
      } catch (error) {
        if (uniqueViolation(error)) {
          throw new AppError(
            'CREATOR_IDENTITY_CONFLICT',
            'This Bilibili UID or room is already assigned.',
            409,
          );
        }
        throw error;
      }
    });
  }

  public async updateOwn(
    creatorId: string,
    input: RequestAuditContext & {
      readonly displayName?: string;
    },
  ) {
    const [before] = await this.database.orm
      .select()
      .from(creators)
      .where(eq(creators.id, creatorId))
      .limit(1);
    if (!before) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
    return this.update({
      ...input,
      creatorId,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    });
  }

  public async summary() {
    const [all] = await this.database.orm.select({ value: count() }).from(creators);
    const [active] = await this.database.orm
      .select({ value: count() })
      .from(creators)
      .where(and(eq(creators.active, true), isNull(creators.archivedAt)));
    const recent = await this.database.orm
      .select({
        active: creators.active,
        displayName: creators.displayName,
        id: creators.id,
        updatedAt: creators.updatedAt,
      })
      .from(creators)
      .orderBy(desc(creators.updatedAt))
      .limit(5);
    return { activeCreators: active?.value ?? 0, creators: all?.value ?? 0, recent };
  }
}
