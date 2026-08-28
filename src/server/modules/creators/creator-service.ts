import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, or } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  creators,
  snapshotRuns,
  users,
} from '../../infrastructure/db/schema/index.js';
import {
  CreatorProfileSourceError,
  type BilibiliCreatorProfile,
  type CreatorProfileSource,
} from '../bilibili/creator-profile-source.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import { calculateMonthlyCutoff, normalizeIanaTimezone } from '../snapshots/month-end.js';

export interface RegisterCreatorInput extends RequestAuditContext {
  readonly monthlySyncEnabled?: boolean;
  readonly timezone: string;
  readonly userId: string;
}

export interface UpdateCreatorSettingsInput extends RequestAuditContext {
  readonly creatorId: string;
  readonly monthlySyncEnabled?: boolean;
  readonly timezone?: string;
}

export interface RefreshCreatorProfileInput extends RequestAuditContext {
  readonly creatorId: string;
}

function uniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && uniqueViolation(error.cause);
}

function normalizeTimezone(value: string): string {
  try {
    return normalizeIanaTimezone(value);
  } catch {
    throw new AppError('CREATOR_TIMEZONE_INVALID', 'A valid IANA timezone is required.', 400);
  }
}

function normalizeProfile(
  profile: BilibiliCreatorProfile,
  expectedBiliUid: string,
): BilibiliCreatorProfile {
  const biliUid = profile.biliUid.trim();
  const displayName = profile.displayName.trim();
  const roomId = profile.roomId.trim();
  if (
    biliUid !== expectedBiliUid ||
    !/^[0-9]{1,32}$/.test(biliUid) ||
    !/^[0-9]{1,32}$/.test(roomId) ||
    !displayName ||
    displayName.length > 120
  ) {
    throw new AppError(
      'CREATOR_BILIBILI_PROFILE_INVALID',
      'Bilibili returned an invalid creator profile.',
      502,
    );
  }
  return { biliUid, displayName, roomId };
}

export class CreatorService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly profiles: CreatorProfileSource,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async fetchProfile(biliUid: string): Promise<BilibiliCreatorProfile> {
    try {
      return normalizeProfile(
        await this.profiles.fetchByUid(biliUid, AbortSignal.timeout(10_000)),
        biliUid,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof CreatorProfileSourceError && error.code === 'LIVE_ROOM_REQUIRED') {
        throw new AppError(
          'CREATOR_LIVE_ROOM_REQUIRED',
          'This Bilibili account does not have an available live room.',
          409,
        );
      }
      throw new AppError(
        'CREATOR_BILIBILI_PROFILE_UNAVAILABLE',
        'The Bilibili creator profile could not be refreshed. Try again later.',
        502,
      );
    }
  }

  private async record(creatorId: string, executor: AppDatabase = this.database.orm) {
    const [record] = await executor
      .select({
        bilibiliUid: creators.bilibiliUid,
        createdAt: creators.createdAt,
        displayName: creators.displayName,
        email: users.email,
        id: creators.id,
        monthlySyncEnabled: creators.monthlySyncEnabled,
        profileSyncedAt: creators.profileSyncedAt,
        roomId: creators.roomId,
        timezone: creators.timezone,
        userId: creators.userId,
        userName: users.name,
      })
      .from(creators)
      .innerJoin(users, eq(users.id, creators.userId))
      .where(eq(creators.id, creatorId))
      .limit(1);
    if (!record) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
    return record;
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
              bilibiliUid: creators.bilibiliUid,
              displayName: creators.displayName,
              id: creators.id,
              monthlySyncEnabled: creators.monthlySyncEnabled,
              profileSyncedAt: creators.profileSyncedAt,
              roomId: creators.roomId,
              timezone: creators.timezone,
            })
            .from(creators)
            .where(eq(creators.userId, user.id))
            .limit(1)
        : [];
    return { creator: creator ?? null, user };
  }

  public async listUsers(search = '') {
    const normalized = search.trim();
    return this.database.orm
      .select({
        bilibiliBinding: {
          biliDisplayName: bilibiliBindings.biliDisplayName,
          biliUid: bilibiliBindings.biliUid,
          id: bilibiliBindings.id,
        },
        email: users.email,
        id: users.id,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .leftJoin(
        bilibiliBindings,
        and(eq(bilibiliBindings.userId, users.id), isNull(bilibiliBindings.unboundAt)),
      )
      .where(
        normalized
          ? or(
              ilike(users.email, `%${normalized}%`),
              ilike(users.name, `%${normalized}%`),
              ilike(bilibiliBindings.biliUid, `%${normalized}%`),
              ilike(bilibiliBindings.biliDisplayName, `%${normalized}%`),
            )
          : undefined,
      )
      .orderBy(asc(users.name))
      .limit(100);
  }

  public listCreators() {
    return this.database.orm
      .select({
        bilibiliUid: creators.bilibiliUid,
        createdAt: creators.createdAt,
        displayName: creators.displayName,
        email: users.email,
        id: creators.id,
        monthlySyncEnabled: creators.monthlySyncEnabled,
        profileSyncedAt: creators.profileSyncedAt,
        roomId: creators.roomId,
        timezone: creators.timezone,
        userId: creators.userId,
        userName: users.name,
      })
      .from(creators)
      .innerJoin(users, eq(users.id, creators.userId))
      .orderBy(asc(creators.displayName));
  }

  public async register(input: RegisterCreatorInput) {
    const timezone = normalizeTimezone(input.timezone);
    const [candidate] = await this.database.orm
      .select({
        bindingId: bilibiliBindings.id,
        biliUid: bilibiliBindings.biliUid,
        role: users.role,
      })
      .from(users)
      .leftJoin(
        bilibiliBindings,
        and(eq(bilibiliBindings.userId, users.id), isNull(bilibiliBindings.unboundAt)),
      )
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!candidate) throw new AppError('USER_NOT_FOUND', 'User account not found.', 404);
    if (candidate.role !== 'USER') {
      throw new AppError(
        'CREATOR_PROMOTION_NOT_ALLOWED',
        'Only an ordinary user can be registered as a creator.',
        409,
      );
    }
    if (!candidate.bindingId || !candidate.biliUid) {
      throw new AppError(
        'CREATOR_BILIBILI_BINDING_REQUIRED',
        'The user must verify a Bilibili account before creator registration.',
        409,
      );
    }
    const bindingId = candidate.bindingId;
    const profile = await this.fetchProfile(candidate.biliUid);
    try {
      return await this.database.orm.transaction(async (transaction) => {
        const [locked] = await transaction
          .select({
            bindingId: bilibiliBindings.id,
            biliUid: bilibiliBindings.biliUid,
            email: users.email,
            name: users.name,
            role: users.role,
            userId: users.id,
          })
          .from(users)
          .innerJoin(
            bilibiliBindings,
            and(eq(bilibiliBindings.userId, users.id), isNull(bilibiliBindings.unboundAt)),
          )
          .where(and(eq(users.id, input.userId), eq(bilibiliBindings.id, bindingId)))
          .limit(1)
          .for('update');
        if (!locked || locked.role !== 'USER' || locked.biliUid !== profile.biliUid) {
          throw new AppError(
            'CREATOR_REGISTRATION_CHANGED',
            'The account or Bilibili binding changed during creator registration.',
            409,
          );
        }
        const now = this.clock.now();
        const [creator] = await transaction
          .insert(creators)
          .values({
            bilibiliUid: profile.biliUid,
            bindingId: locked.bindingId,
            displayName: profile.displayName,
            monthlySyncEnabled: input.monthlySyncEnabled ?? true,
            profileSyncedAt: now,
            roomId: profile.roomId,
            timezone,
            userId: locked.userId,
          })
          .returning();
        if (!creator) throw new Error('Creator insert returned no row.');
        await transaction
          .update(users)
          .set({ role: 'CREATOR', updatedAt: now })
          .where(eq(users.id, locked.userId));
        await transaction
          .update(bilibiliBindings)
          .set({ biliDisplayName: profile.displayName, updatedAt: now })
          .where(eq(bilibiliBindings.id, locked.bindingId));
        await this.audit.record(
          {
            action: 'creator.registered',
            actorUserId: input.actorUserId,
            afterSummary: {
              bilibiliUid: creator.bilibiliUid,
              displayName: creator.displayName,
              monthlySyncEnabled: creator.monthlySyncEnabled,
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
        return { ...creator, email: locked.email, userName: locked.name };
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new AppError(
          'CREATOR_IDENTITY_CONFLICT',
          'This account, Bilibili UID, or live room is already assigned.',
          409,
        );
      }
      throw error;
    }
  }

  public async updateSettings(input: UpdateCreatorSettingsInput) {
    const timezone = input.timezone === undefined ? undefined : normalizeTimezone(input.timezone);
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(creators)
        .where(eq(creators.id, input.creatorId))
        .limit(1)
        .for('update');
      if (!before) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
      const now = this.clock.now();
      const [updated] = await transaction
        .update(creators)
        .set({
          monthlySyncEnabled: input.monthlySyncEnabled ?? before.monthlySyncEnabled,
          timezone: timezone ?? before.timezone,
          updatedAt: now,
        })
        .where(eq(creators.id, before.id))
        .returning();
      if (!updated) throw new Error('Creator settings update returned no row.');

      const pendingRuns = await transaction
        .select({
          id: snapshotRuns.id,
          periodStart: snapshotRuns.periodStart,
          scheduledCutoffAt: snapshotRuns.scheduledCutoffAt,
          status: snapshotRuns.status,
        })
        .from(snapshotRuns)
        .where(
          and(
            eq(snapshotRuns.creatorId, updated.id),
            inArray(snapshotRuns.status, ['SCHEDULED', 'CANCELLED']),
          ),
        );
      for (const run of pendingRuns) {
        const future = run.scheduledCutoffAt > now;
        if (!future && (updated.monthlySyncEnabled || run.status !== 'SCHEDULED')) continue;
        const cutoff = future
          ? calculateMonthlyCutoff(run.periodStart, updated.timezone)
          : undefined;
        await transaction
          .update(snapshotRuns)
          .set({
            ...(cutoff
              ? {
                  cutoffTimezone: cutoff.cutoffTimezone,
                  onTimeWindowEndAt: cutoff.onTimeWindowEndAt,
                  scheduledCutoffAt: cutoff.scheduledCutoffAt,
                }
              : {}),
            status: updated.monthlySyncEnabled ? 'SCHEDULED' : 'CANCELLED',
            updatedAt: now,
          })
          .where(eq(snapshotRuns.id, run.id));
      }
      await this.audit.record(
        {
          action: 'creator.settings-updated',
          actorUserId: input.actorUserId,
          afterSummary: {
            monthlySyncEnabled: updated.monthlySyncEnabled,
            timezone: updated.timezone,
          },
          beforeSummary: {
            monthlySyncEnabled: before.monthlySyncEnabled,
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
      return this.record(updated.id, transaction);
    });
  }

  public async refreshProfile(input: RefreshCreatorProfileInput) {
    const [current] = await this.database.orm
      .select({ biliUid: creators.bilibiliUid })
      .from(creators)
      .where(eq(creators.id, input.creatorId))
      .limit(1);
    if (!current) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
    const profile = await this.fetchProfile(current.biliUid);
    try {
      return await this.database.orm.transaction(async (transaction) => {
        const [before] = await transaction
          .select()
          .from(creators)
          .where(eq(creators.id, input.creatorId))
          .limit(1)
          .for('update');
        if (!before) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
        if (before.bilibiliUid !== profile.biliUid) {
          throw new AppError(
            'CREATOR_PROFILE_CHANGED',
            'The creator identity changed while the Bilibili profile was being refreshed.',
            409,
          );
        }
        const now = this.clock.now();
        const [updated] = await transaction
          .update(creators)
          .set({
            displayName: profile.displayName,
            profileSyncedAt: now,
            roomId: profile.roomId,
            updatedAt: now,
          })
          .where(eq(creators.id, before.id))
          .returning();
        if (!updated) throw new Error('Creator profile refresh returned no row.');
        await transaction
          .update(bilibiliBindings)
          .set({ biliDisplayName: profile.displayName, updatedAt: now })
          .where(eq(bilibiliBindings.id, before.bindingId));
        await transaction
          .update(snapshotRuns)
          .set({
            creatorBilibiliUid: profile.biliUid,
            creatorRoomId: profile.roomId,
            updatedAt: now,
          })
          .where(
            and(
              eq(snapshotRuns.creatorId, updated.id),
              inArray(snapshotRuns.status, ['SCHEDULED', 'CANCELLED']),
              gt(snapshotRuns.scheduledCutoffAt, now),
            ),
          );
        await this.audit.record(
          {
            action: 'creator.profile-refreshed',
            actorUserId: input.actorUserId,
            afterSummary: {
              displayName: updated.displayName,
              profileSyncedAt: updated.profileSyncedAt,
              roomId: updated.roomId,
            },
            beforeSummary: {
              displayName: before.displayName,
              profileSyncedAt: before.profileSyncedAt,
              roomId: before.roomId,
            },
            creatorId: updated.id,
            ipAddress: input.ipAddress,
            requestId: input.requestId,
            targetId: updated.id,
            targetType: 'creator',
          },
          transaction,
        );
        return this.record(updated.id, transaction);
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new AppError(
          'CREATOR_ROOM_CONFLICT',
          'The refreshed Bilibili live room is already assigned to another creator.',
          409,
        );
      }
      throw error;
    }
  }

  public async summary() {
    const [all] = await this.database.orm.select({ value: count() }).from(creators);
    const [monthlySync] = await this.database.orm
      .select({ value: count() })
      .from(creators)
      .where(eq(creators.monthlySyncEnabled, true));
    const recent = await this.database.orm
      .select({
        displayName: creators.displayName,
        id: creators.id,
        monthlySyncEnabled: creators.monthlySyncEnabled,
        updatedAt: creators.updatedAt,
      })
      .from(creators)
      .orderBy(desc(creators.updatedAt))
      .limit(5);
    return {
      creators: all?.value ?? 0,
      monthlySyncCreators: monthlySync?.value ?? 0,
      recent,
    };
  }
}
