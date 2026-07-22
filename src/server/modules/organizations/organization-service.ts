import { and, count, eq, inArray, isNull } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { OrganizationRole } from '../../../shared/permissions/permissions.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  creators,
  memberCreatorScopes,
  organizationMembers,
  organizations,
  users,
} from '../../infrastructure/db/schema.js';
import { AuditService } from '../audit/audit-service.js';
import { normalizeIanaTimezone } from '../snapshots/month-end.js';

export interface RequestAuditContext {
  readonly actorUserId: string;
  readonly ipAddress: string;
  readonly requestId: string;
}

export interface CreateOrganizationInput extends RequestAuditContext {
  readonly name: string;
  readonly ownerUserId: string;
  readonly slug: string;
}

export interface CreateMemberInput extends RequestAuditContext {
  readonly creatorIds: readonly string[];
  readonly organizationId: string;
  readonly role: OrganizationRole;
  readonly userId: string;
}

export interface UpdateMemberInput extends RequestAuditContext {
  readonly creatorIds?: readonly string[];
  readonly memberId: string;
  readonly organizationId: string;
  readonly role?: OrganizationRole;
}

export interface CreateCreatorInput extends RequestAuditContext {
  readonly active: boolean;
  readonly bilibiliUid: string;
  readonly displayName: string;
  readonly organizationId: string;
  readonly roomId: string;
  readonly timezone: string;
}

export interface UpdateCreatorInput extends RequestAuditContext {
  readonly active?: boolean;
  readonly bilibiliUid?: string;
  readonly creatorId: string;
  readonly displayName?: string;
  readonly organizationId: string;
  readonly roomId?: string;
  readonly timezone?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function assertIanaTimezone(timezone: string): void {
  try {
    normalizeIanaTimezone(timezone);
  } catch {
    throw new AppError('TIMEZONE_INVALID', 'A valid IANA timezone is required.', 400);
  }
}

export class OrganizationService {
  private readonly audit: AuditService;

  public constructor(private readonly database: DatabaseService) {
    this.audit = new AuditService(database);
  }

  public async listPlatformOrganizations() {
    return this.database.orm
      .select({
        archivedAt: organizations.archivedAt,
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizations)
      .orderBy(organizations.name);
  }

  public async createOrganization(input: CreateOrganizationInput) {
    try {
      return await this.database.orm.transaction(async (transaction) => {
        const [owner] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, input.ownerUserId))
          .limit(1);
        if (!owner) throw new AppError('USER_NOT_FOUND', 'The owner account was not found.', 404);

        const [organization] = await transaction
          .insert(organizations)
          .values({ name: input.name, slug: input.slug })
          .returning();
        if (!organization) throw new Error('Organization insert returned no row.');

        const [membership] = await transaction
          .insert(organizationMembers)
          .values({
            organizationId: organization.id,
            role: 'OWNER',
            userId: owner.id,
          })
          .returning();
        if (!membership) throw new Error('Owner membership insert returned no row.');

        await this.audit.record(
          {
            action: 'organization.created',
            actorUserId: input.actorUserId,
            afterSummary: { name: organization.name, slug: organization.slug },
            ipAddress: input.ipAddress,
            organizationId: organization.id,
            requestId: input.requestId,
            targetId: organization.id,
            targetType: 'organization',
          },
          transaction,
        );
        await this.audit.record(
          {
            action: 'organization-member.added',
            actorUserId: input.actorUserId,
            afterSummary: { role: 'OWNER', userId: owner.id },
            ipAddress: input.ipAddress,
            organizationId: organization.id,
            requestId: input.requestId,
            targetId: membership.id,
            targetType: 'organization-member',
          },
          transaction,
        );
        return organization;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('ORGANIZATION_SLUG_CONFLICT', 'Organization slug already exists.', 409);
      }
      throw error;
    }
  }

  public async getOrganization(organizationId: string) {
    const [organization] = await this.database.orm
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), isNull(organizations.archivedAt)))
      .limit(1);
    if (!organization) throw new AppError('ORGANIZATION_NOT_FOUND', 'Organization not found.', 404);
    return organization;
  }

  public async updateOrganization(
    input: RequestAuditContext & { readonly name: string; readonly organizationId: string },
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, input.organizationId), isNull(organizations.archivedAt)))
        .limit(1);
      if (!before) throw new AppError('ORGANIZATION_NOT_FOUND', 'Organization not found.', 404);
      const [organization] = await transaction
        .update(organizations)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(organizations.id, input.organizationId))
        .returning();
      if (!organization) throw new Error('Organization update returned no row.');
      await this.audit.record(
        {
          action: 'organization.updated',
          actorUserId: input.actorUserId,
          afterSummary: { name: organization.name },
          beforeSummary: { name: before.name },
          ipAddress: input.ipAddress,
          organizationId: organization.id,
          requestId: input.requestId,
          targetId: organization.id,
          targetType: 'organization',
        },
        transaction,
      );
      return organization;
    });
  }

  public async listMembers(organizationId: string) {
    const rows = await this.database.orm
      .select({
        email: users.email,
        id: organizationMembers.id,
        name: users.name,
        role: organizationMembers.role,
        userId: organizationMembers.userId,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, organizationId))
      .orderBy(users.name);
    if (rows.length === 0) return [];

    const scopes = await this.database.orm
      .select({ creatorId: memberCreatorScopes.creatorId, memberId: memberCreatorScopes.memberId })
      .from(memberCreatorScopes)
      .where(
        inArray(
          memberCreatorScopes.memberId,
          rows.map((row) => row.id),
        ),
      );
    return rows.map((row) => ({
      ...row,
      creatorIds: scopes
        .filter((scope) => scope.memberId === row.id)
        .map((scope) => scope.creatorId),
    }));
  }

  private async assertCreatorScopes(
    organizationId: string,
    creatorIds: readonly string[],
    executor: DatabaseService['orm'],
  ): Promise<void> {
    if (creatorIds.length === 0) return;
    const rows = await executor
      .select({ id: creators.id })
      .from(creators)
      .where(
        and(eq(creators.organizationId, organizationId), inArray(creators.id, [...creatorIds])),
      );
    if (rows.length !== new Set(creatorIds).size) {
      throw new AppError(
        'CREATOR_SCOPE_INVALID',
        'A creator scope is outside the organization.',
        400,
      );
    }
  }

  public async addMember(input: CreateMemberInput) {
    try {
      return await this.database.orm.transaction(async (transaction) => {
        await this.assertCreatorScopes(input.organizationId, input.creatorIds, transaction);
        const [user] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1);
        if (!user) throw new AppError('USER_NOT_FOUND', 'The member account was not found.', 404);

        const [membership] = await transaction
          .insert(organizationMembers)
          .values({
            organizationId: input.organizationId,
            role: input.role,
            userId: input.userId,
          })
          .returning();
        if (!membership) throw new Error('Membership insert returned no row.');
        if (input.creatorIds.length > 0) {
          await transaction.insert(memberCreatorScopes).values(
            [...new Set(input.creatorIds)].map((creatorId) => ({
              creatorId,
              memberId: membership.id,
            })),
          );
        }
        await this.audit.record(
          {
            action: 'organization-member.added',
            actorUserId: input.actorUserId,
            afterSummary: {
              creatorIds: [...input.creatorIds],
              role: input.role,
              userId: input.userId,
            },
            ipAddress: input.ipAddress,
            organizationId: input.organizationId,
            requestId: input.requestId,
            targetId: membership.id,
            targetType: 'organization-member',
          },
          transaction,
        );
        return { ...membership, creatorIds: [...input.creatorIds] };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('ORGANIZATION_MEMBER_CONFLICT', 'The user is already a member.', 409);
      }
      throw error;
    }
  }

  private async assertNotLastOwner(
    organizationId: string,
    memberId: string,
    executor: DatabaseService['orm'],
  ): Promise<void> {
    const [target] = await executor
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.id, memberId),
          eq(organizationMembers.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!target) throw new AppError('ORGANIZATION_MEMBER_NOT_FOUND', 'Member not found.', 404);
    if (target.role !== 'OWNER') return;
    const [owners] = await executor
      .select({ value: count() })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, 'OWNER'),
        ),
      );
    if ((owners?.value ?? 0) <= 1) {
      throw new AppError('LAST_OWNER_REQUIRED', 'An organization must retain an owner.', 409);
    }
  }

  public async updateMember(input: UpdateMemberInput) {
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.id, input.memberId),
            eq(organizationMembers.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!before) throw new AppError('ORGANIZATION_MEMBER_NOT_FOUND', 'Member not found.', 404);
      if (before.role === 'OWNER' && input.role && input.role !== 'OWNER') {
        await this.assertNotLastOwner(input.organizationId, input.memberId, transaction);
      }
      if (input.creatorIds) {
        await this.assertCreatorScopes(input.organizationId, input.creatorIds, transaction);
      }

      const previousScopes = await transaction
        .select({ creatorId: memberCreatorScopes.creatorId })
        .from(memberCreatorScopes)
        .where(eq(memberCreatorScopes.memberId, input.memberId));

      const [membership] = await transaction
        .update(organizationMembers)
        .set({ role: input.role ?? before.role, updatedAt: new Date() })
        .where(eq(organizationMembers.id, input.memberId))
        .returning();
      if (!membership) throw new Error('Membership update returned no row.');
      if (input.creatorIds) {
        await transaction
          .delete(memberCreatorScopes)
          .where(eq(memberCreatorScopes.memberId, input.memberId));
        if (input.creatorIds.length > 0) {
          await transaction.insert(memberCreatorScopes).values(
            [...new Set(input.creatorIds)].map((creatorId) => ({
              creatorId,
              memberId: input.memberId,
            })),
          );
        }
      }
      const creatorIds = input.creatorIds ?? previousScopes.map((scope) => scope.creatorId);
      await this.audit.record(
        {
          action: 'organization-member.permissions-updated',
          actorUserId: input.actorUserId,
          afterSummary: { creatorIds, role: membership.role },
          beforeSummary: {
            creatorIds: previousScopes.map((scope) => scope.creatorId),
            role: before.role,
          },
          ipAddress: input.ipAddress,
          organizationId: input.organizationId,
          requestId: input.requestId,
          targetId: membership.id,
          targetType: 'organization-member',
        },
        transaction,
      );
      return { ...membership, creatorIds };
    });
  }

  public async removeMember(
    input: RequestAuditContext & {
      readonly memberId: string;
      readonly organizationId: string;
    },
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      await this.assertNotLastOwner(input.organizationId, input.memberId, transaction);
      const [removed] = await transaction
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.id, input.memberId),
            eq(organizationMembers.organizationId, input.organizationId),
          ),
        )
        .returning();
      if (!removed) throw new AppError('ORGANIZATION_MEMBER_NOT_FOUND', 'Member not found.', 404);
      await this.audit.record(
        {
          action: 'organization-member.removed',
          actorUserId: input.actorUserId,
          beforeSummary: { role: removed.role, userId: removed.userId },
          ipAddress: input.ipAddress,
          organizationId: input.organizationId,
          requestId: input.requestId,
          targetId: removed.id,
          targetType: 'organization-member',
        },
        transaction,
      );
    });
  }

  public async listCreators(organizationId: string, allowedCreatorIds?: readonly string[]) {
    const conditions = [eq(creators.organizationId, organizationId), isNull(creators.archivedAt)];
    if (allowedCreatorIds && allowedCreatorIds.length > 0) {
      conditions.push(inArray(creators.id, [...allowedCreatorIds]));
    }
    return this.database.orm
      .select()
      .from(creators)
      .where(and(...conditions))
      .orderBy(creators.displayName);
  }

  public async createCreator(input: CreateCreatorInput) {
    assertIanaTimezone(input.timezone);
    try {
      return await this.database.orm.transaction(async (transaction) => {
        const [creator] = await transaction
          .insert(creators)
          .values({
            active: input.active,
            bilibiliUid: input.bilibiliUid,
            displayName: input.displayName,
            organizationId: input.organizationId,
            roomId: input.roomId,
            timezone: input.timezone,
          })
          .returning();
        if (!creator) throw new Error('Creator insert returned no row.');
        await this.audit.record(
          {
            action: 'creator.created',
            actorUserId: input.actorUserId,
            afterSummary: {
              active: creator.active,
              bilibiliUid: creator.bilibiliUid,
              displayName: creator.displayName,
              roomId: creator.roomId,
              timezone: creator.timezone,
            },
            creatorId: creator.id,
            ipAddress: input.ipAddress,
            organizationId: input.organizationId,
            requestId: input.requestId,
            targetId: creator.id,
            targetType: 'creator',
          },
          transaction,
        );
        return creator;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'CREATOR_UID_CONFLICT',
          'The Bilibili UID already exists in this organization.',
          409,
        );
      }
      throw error;
    }
  }

  public async updateCreator(input: UpdateCreatorInput) {
    if (input.timezone) assertIanaTimezone(input.timezone);
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(creators)
        .where(
          and(
            eq(creators.id, input.creatorId),
            eq(creators.organizationId, input.organizationId),
            isNull(creators.archivedAt),
          ),
        )
        .limit(1);
      if (!before) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
      const [creator] = await transaction
        .update(creators)
        .set({
          active: input.active ?? before.active,
          bilibiliUid: input.bilibiliUid ?? before.bilibiliUid,
          displayName: input.displayName ?? before.displayName,
          roomId: input.roomId ?? before.roomId,
          timezone: input.timezone ?? before.timezone,
          updatedAt: new Date(),
        })
        .where(
          and(eq(creators.id, input.creatorId), eq(creators.organizationId, input.organizationId)),
        )
        .returning();
      if (!creator) throw new Error('Creator update returned no row.');
      await this.audit.record(
        {
          action: 'creator.updated',
          actorUserId: input.actorUserId,
          afterSummary: {
            active: creator.active,
            bilibiliUid: creator.bilibiliUid,
            displayName: creator.displayName,
            roomId: creator.roomId,
            timezone: creator.timezone,
          },
          beforeSummary: {
            active: before.active,
            bilibiliUid: before.bilibiliUid,
            displayName: before.displayName,
            roomId: before.roomId,
            timezone: before.timezone,
          },
          creatorId: creator.id,
          ipAddress: input.ipAddress,
          organizationId: input.organizationId,
          requestId: input.requestId,
          targetId: creator.id,
          targetType: 'creator',
        },
        transaction,
      );
      return creator;
    });
  }
}
