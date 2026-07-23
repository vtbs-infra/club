import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import {
  hasOrganizationPermission,
  isOrganizationRole,
  type OrganizationPermission,
} from '../../../shared/permissions/permissions.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  claimAddresses,
  claimEntitlements,
  claimOptionValues,
  claims,
  claimStatusHistory,
  entitlements,
  giftCampaigns,
  giftPackages,
  idempotencyRecords,
  memberCreatorScopes,
  organizationMembers,
  type CampaignClaimField,
} from '../../infrastructure/db/schema.js';
import type {
  EncryptionKeyRing,
  EncryptedValue,
} from '../../infrastructure/encryption/key-ring.js';
import { AddressService } from '../addresses/address-service.js';
import { isAddressPayload, type AddressPayload } from '../addresses/address-domain.js';
import { AuditService } from '../audit/audit-service.js';
import type { AuthSession } from '../auth/auth.js';
import type { RequestAuditContext } from '../campaigns/campaign-service.js';
import {
  canTransitionClaim,
  idempotencyRequestHash,
  normalizeClaimOptions,
  type ClaimStatus,
} from './claim-domain.js';

export interface SubmitClaimInput {
  readonly addressId: string;
  readonly optionValues: Readonly<Record<string, string>>;
  readonly version?: number | undefined;
}

export interface ClaimSummary {
  readonly biliUid: string;
  readonly campaignId: string;
  readonly cancelledAt: string | null;
  readonly claimNumber: string;
  readonly completedAt: string | null;
  readonly id: string;
  readonly processingAt: string | null;
  readonly shippedAt: string | null;
  readonly status: ClaimStatus;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

function encryptedColumns(value: EncryptedValue) {
  return {
    authenticationTag: value.authenticationTag,
    ciphertext: value.ciphertext,
    initializationVector: value.initializationVector,
    keyVersion: value.keyVersion,
  };
}

function summary(row: typeof claims.$inferSelect): ClaimSummary {
  return {
    biliUid: row.biliUid,
    campaignId: row.campaignId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    claimNumber: row.claimNumber,
    completedAt: row.completedAt?.toISOString() ?? null,
    id: row.id,
    processingAt: row.processingAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    status: row.status as ClaimStatus,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export class ClaimService {
  private readonly addresses: AddressService;
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
  ) {
    this.addresses = new AddressService(database, encryption);
    this.audit = new AuditService(database);
  }

  private async databaseNow(executor: AppDatabase): Promise<Date> {
    const [row] = await executor.execute<{ value: Date | string }>(sql`select now() as value`);
    return row!.value instanceof Date ? row!.value : new Date(row!.value);
  }

  private async beginIdempotency(
    executor: AppDatabase,
    input: {
      readonly actorUserId: string;
      readonly key: string;
      readonly now: Date;
      readonly requestHash: string;
      readonly scope: string;
    },
  ): Promise<{ readonly id: string; readonly replay: Record<string, unknown> | null }> {
    await executor
      .delete(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.actorUserId, input.actorUserId),
          eq(idempotencyRecords.scope, input.scope),
          eq(idempotencyRecords.key, input.key),
          lte(idempotencyRecords.expiresAt, input.now),
        ),
      );
    const [inserted] = await executor
      .insert(idempotencyRecords)
      .values({
        actorUserId: input.actorUserId,
        expiresAt: new Date(input.now.getTime() + 24 * 60 * 60_000),
        key: input.key,
        requestHash: input.requestHash,
        scope: input.scope,
      })
      .onConflictDoNothing()
      .returning();
    const record =
      inserted ??
      (
        await executor
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.actorUserId, input.actorUserId),
              eq(idempotencyRecords.scope, input.scope),
              eq(idempotencyRecords.key, input.key),
            ),
          )
          .limit(1)
          .for('update')
      )[0];
    if (!record) throw new Error('Idempotency record was not available.');
    if (record.requestHash !== input.requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'The idempotency key was already used for different input.',
        409,
      );
    }
    return { id: record.id, replay: record.responseBody ?? null };
  }

  private async completeIdempotency(
    executor: AppDatabase,
    id: string,
    response: Record<string, unknown>,
  ) {
    await executor
      .update(idempotencyRecords)
      .set({ responseBody: response, responseStatus: 200 })
      .where(eq(idempotencyRecords.id, id));
  }

  private async nextClaimNumber(executor: AppDatabase, now: Date) {
    const [row] = await executor.execute<{ value: string }>(
      sql`select nextval('claim_number_sequence')::text as value`,
    );
    return `CLM-${now.getUTCFullYear()}-${row!.value.padStart(8, '0')}`;
  }

  private async replaceClaimSnapshot(
    executor: AppDatabase,
    input: {
      readonly addressId: string;
      readonly claimId: string;
      readonly optionValues: Readonly<Record<string, string>>;
      readonly schema: readonly CampaignClaimField[];
      readonly userId: string;
    },
  ) {
    const { payload } = await this.addresses.getPlaintext(input.userId, input.addressId, executor);
    const normalizedOptions = normalizeClaimOptions(input.schema, input.optionValues);
    await executor.delete(claimAddresses).where(eq(claimAddresses.claimId, input.claimId));
    await executor.delete(claimOptionValues).where(eq(claimOptionValues.claimId, input.claimId));
    const encryptedAddress = this.encryption.encrypt(payload, `claim-address:${input.claimId}`);
    await executor.insert(claimAddresses).values({
      claimId: input.claimId,
      sourceAddressId: input.addressId,
      ...encryptedColumns(encryptedAddress),
    });
    const optionEntries = Object.entries(normalizedOptions);
    if (optionEntries.length > 0) {
      await executor.insert(claimOptionValues).values(
        optionEntries.map(([fieldKey, value]) => ({
          claimId: input.claimId,
          fieldKey,
          ...encryptedColumns(
            this.encryption.encrypt({ value }, `claim-option:${input.claimId}:${fieldKey}`),
          ),
        })),
      );
    }
  }

  public async submit(
    userId: string,
    campaignId: string,
    input: SubmitClaimInput,
    idempotencyKey: string,
    context: RequestAuditContext,
  ): Promise<ClaimSummary> {
    const requestHash = idempotencyRequestHash(input);
    return this.database.orm.transaction(async (transaction) => {
      const now = await this.databaseNow(transaction);
      const idempotency = await this.beginIdempotency(transaction, {
        actorUserId: userId,
        key: idempotencyKey,
        now,
        requestHash,
        scope: `claim-submit:${campaignId}`,
      });
      if (idempotency.replay) return idempotency.replay as unknown as ClaimSummary;

      const [binding] = await transaction
        .select({ biliUid: bilibiliBindings.biliUid })
        .from(bilibiliBindings)
        .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
        .limit(1);
      if (!binding) {
        throw new AppError(
          'BILIBILI_BINDING_REQUIRED',
          'An active Bilibili binding is required.',
          409,
        );
      }
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${campaignId}:${binding.biliUid}`}, 0))`,
      );
      const [campaign] = await transaction
        .select()
        .from(giftCampaigns)
        .where(
          and(
            eq(giftCampaigns.id, campaignId),
            inArray(giftCampaigns.status, ['PUBLISHED', 'CLOSED']),
          ),
        )
        .limit(1);
      if (!campaign)
        throw new AppError('CAMPAIGN_NOT_CLAIMABLE', 'Campaign is not claimable.', 409);
      if (now < campaign.claimStartAt) {
        throw new AppError('CLAIM_NOT_OPEN', 'The claim window has not opened.', 409);
      }
      if (now > campaign.claimDeadlineAt) {
        throw new AppError('CLAIM_DEADLINE_PASSED', 'The claim deadline has passed.', 410);
      }
      const eligible = await transaction
        .select()
        .from(entitlements)
        .where(
          and(eq(entitlements.campaignId, campaign.id), eq(entitlements.biliUid, binding.biliUid)),
        );
      if (eligible.length === 0 || eligible.some((entitlement) => entitlement.revokedAt !== null)) {
        throw new AppError(
          'CLAIM_ENTITLEMENTS_INVALID',
          'All campaign entitlements must remain active to claim.',
          409,
        );
      }

      const [existing] = await transaction
        .select()
        .from(claims)
        .where(and(eq(claims.campaignId, campaign.id), eq(claims.biliUid, binding.biliUid)))
        .limit(1)
        .for('update');
      let claim: typeof claims.$inferSelect;
      if (existing) {
        if (existing.userId !== userId) {
          throw new AppError(
            'CLAIM_ALREADY_OWNED',
            'This gift was already claimed by the previously bound account.',
            409,
          );
        }
        if (existing.status !== 'CANCELLED') {
          throw new AppError(
            'CLAIM_ALREADY_EXISTS',
            'A claim already exists for this campaign.',
            409,
          );
        }
        if (input.version !== undefined && input.version !== existing.version) {
          throw new AppError(
            'CLAIM_VERSION_CONFLICT',
            'The claim changed before this request.',
            409,
          );
        }
        const links = await transaction
          .select({ entitlementId: claimEntitlements.entitlementId })
          .from(claimEntitlements)
          .where(eq(claimEntitlements.claimId, existing.id));
        const eligibleIds = new Set(eligible.map((entitlement) => entitlement.id));
        if (
          links.length !== eligibleIds.size ||
          links.some((link) => !eligibleIds.has(link.entitlementId))
        ) {
          throw new AppError(
            'CLAIM_ENTITLEMENTS_INVALID',
            'Claim entitlements no longer match active eligibility.',
            409,
          );
        }
        const [updated] = await transaction
          .update(claims)
          .set({
            cancelReason: null,
            cancelledAt: null,
            completedAt: null,
            processingAt: null,
            shippedAt: null,
            status: 'SUBMITTED',
            submittedAt: now,
            updatedAt: now,
            version: sql`${claims.version} + 1`,
          })
          .where(eq(claims.id, existing.id))
          .returning();
        claim = updated!;
        await transaction.insert(claimStatusHistory).values({
          actorUserId: userId,
          claimId: claim.id,
          fromStatus: 'CANCELLED',
          toStatus: 'SUBMITTED',
        });
      } else {
        const [created] = await transaction
          .insert(claims)
          .values({
            biliUid: binding.biliUid,
            campaignId: campaign.id,
            claimNumber: await this.nextClaimNumber(transaction, now),
            creatorId: campaign.creatorId,
            organizationId: campaign.organizationId,
            status: 'SUBMITTED',
            submittedAt: now,
            userId,
            updatedAt: now,
          })
          .returning();
        claim = created!;
        await transaction
          .insert(claimEntitlements)
          .values(
            eligible.map((entitlement) => ({ claimId: claim.id, entitlementId: entitlement.id })),
          );
        await transaction.insert(claimStatusHistory).values({
          actorUserId: userId,
          claimId: claim.id,
          fromStatus: null,
          toStatus: 'SUBMITTED',
        });
      }

      await this.replaceClaimSnapshot(transaction, {
        addressId: input.addressId,
        claimId: claim.id,
        optionValues: input.optionValues,
        schema: campaign.claimFormSchema,
        userId,
      });
      const result = summary(claim);
      await this.completeIdempotency(
        transaction,
        idempotency.id,
        result as unknown as Record<string, unknown>,
      );
      await this.audit.record(
        {
          action: existing ? 'claim.resubmitted' : 'claim.submitted',
          actorUserId: userId,
          afterSummary: { claimNumber: claim.claimNumber, status: claim.status },
          creatorId: claim.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: claim.organizationId,
          requestId: context.requestId ?? null,
          targetId: claim.id,
          targetType: 'claim',
        },
        transaction,
      );
      return result;
    });
  }

  public async listForUser(userId: string) {
    const rows = await this.database.orm
      .select()
      .from(claims)
      .where(eq(claims.userId, userId))
      .orderBy(desc(claims.updatedAt));
    return rows.map(summary);
  }

  public async getDetailForUser(userId: string, claimId: string, context: RequestAuditContext) {
    const [claim] = await this.database.orm
      .select()
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.userId, userId)))
      .limit(1);
    if (!claim) throw new AppError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
    const [address, options, history, packages] = await Promise.all([
      this.database.orm
        .select()
        .from(claimAddresses)
        .where(eq(claimAddresses.claimId, claim.id))
        .limit(1),
      this.database.orm
        .select()
        .from(claimOptionValues)
        .where(eq(claimOptionValues.claimId, claim.id))
        .orderBy(asc(claimOptionValues.fieldKey)),
      this.database.orm
        .select()
        .from(claimStatusHistory)
        .where(eq(claimStatusHistory.claimId, claim.id))
        .orderBy(asc(claimStatusHistory.createdAt)),
      this.database.orm
        .select({ entitlementId: entitlements.id, giftPackage: giftPackages })
        .from(claimEntitlements)
        .innerJoin(entitlements, eq(entitlements.id, claimEntitlements.entitlementId))
        .innerJoin(giftPackages, eq(giftPackages.id, entitlements.giftPackageId))
        .where(eq(claimEntitlements.claimId, claim.id))
        .orderBy(asc(giftPackages.sortOrder)),
    ]);
    const payload = address[0] ? this.decryptClaimAddress(claim.id, address[0]) : null;
    const optionValues = Object.fromEntries(
      options.map((option) => [option.fieldKey, this.decryptClaimOption(claim.id, option)]),
    );
    await this.audit.record({
      action: 'claim.address-read',
      actorUserId: context.actorUserId,
      afterSummary: { source: 'recipient-claim-detail' },
      creatorId: claim.creatorId,
      ipAddress: context.ipAddress ?? null,
      organizationId: claim.organizationId,
      requestId: context.requestId ?? null,
      targetId: claim.id,
      targetType: 'claim',
    });
    return {
      ...summary(claim),
      address: payload,
      history: history.map((item) => ({
        createdAt: item.createdAt.toISOString(),
        fromStatus: item.fromStatus,
        reason: item.reason,
        toStatus: item.toStatus,
      })),
      optionValues,
      packages,
    };
  }

  private decryptClaimAddress(claimId: string, row: typeof claimAddresses.$inferSelect) {
    try {
      const payload = this.encryption.decrypt<AddressPayload>(
        {
          authenticationTag: row.authenticationTag,
          ciphertext: row.ciphertext,
          initializationVector: row.initializationVector,
          keyVersion: row.keyVersion,
        },
        `claim-address:${claimId}`,
      );
      if (!isAddressPayload(payload)) throw new Error('Invalid payload');
      return payload;
    } catch {
      throw new AppError(
        'CLAIM_ADDRESS_DECRYPTION_FAILED',
        'An encrypted claim address could not be read with the configured key ring.',
        500,
      );
    }
  }

  private decryptClaimOption(claimId: string, row: typeof claimOptionValues.$inferSelect) {
    try {
      const result = this.encryption.decrypt<{ value: unknown }>(
        {
          authenticationTag: row.authenticationTag,
          ciphertext: row.ciphertext,
          initializationVector: row.initializationVector,
          keyVersion: row.keyVersion,
        },
        `claim-option:${claimId}:${row.fieldKey}`,
      );
      if (typeof result.value !== 'string') throw new Error('Invalid option');
      return result.value;
    } catch {
      throw new AppError(
        'CLAIM_OPTION_DECRYPTION_FAILED',
        'An encrypted claim option could not be read with the configured key ring.',
        500,
      );
    }
  }

  private async lockOwnedClaim(
    executor: AppDatabase,
    userId: string,
    claimId: string,
    version: number,
  ) {
    const [claim] = await executor
      .select()
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.userId, userId)))
      .limit(1)
      .for('update');
    if (!claim) throw new AppError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
    if (claim.version !== version) {
      throw new AppError('CLAIM_VERSION_CONFLICT', 'The claim changed before this request.', 409);
    }
    return claim;
  }

  public async updateAddress(
    userId: string,
    claimId: string,
    addressId: string,
    version: number,
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const claim = await this.lockOwnedClaim(transaction, userId, claimId, version);
      if (claim.status !== 'SUBMITTED') {
        throw new AppError('CLAIM_FROZEN', 'Claim address is frozen after processing starts.', 409);
      }
      const { payload } = await this.addresses.getPlaintext(userId, addressId, transaction);
      const encrypted = this.encryption.encrypt(payload, `claim-address:${claim.id}`);
      const [existing] = await transaction
        .select({ id: claimAddresses.id })
        .from(claimAddresses)
        .where(eq(claimAddresses.claimId, claim.id));
      if (existing) {
        await transaction
          .update(claimAddresses)
          .set({
            sourceAddressId: addressId,
            updatedAt: await this.databaseNow(transaction),
            ...encryptedColumns(encrypted),
          })
          .where(eq(claimAddresses.id, existing.id));
      } else {
        await transaction.insert(claimAddresses).values({
          claimId: claim.id,
          sourceAddressId: addressId,
          ...encryptedColumns(encrypted),
        });
      }
      const now = await this.databaseNow(transaction);
      const [updated] = await transaction
        .update(claims)
        .set({ updatedAt: now, version: sql`${claims.version} + 1` })
        .where(eq(claims.id, claim.id))
        .returning();
      await this.audit.record(
        {
          action: 'claim.address-updated',
          actorUserId: userId,
          afterSummary: { version: updated!.version },
          creatorId: claim.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: claim.organizationId,
          requestId: context.requestId ?? null,
          targetId: claim.id,
          targetType: 'claim',
        },
        transaction,
      );
      return summary(updated!);
    });
  }

  public async updateOptions(
    userId: string,
    claimId: string,
    optionValues: Readonly<Record<string, string>>,
    version: number,
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const claim = await this.lockOwnedClaim(transaction, userId, claimId, version);
      if (claim.status !== 'SUBMITTED') {
        throw new AppError(
          'CLAIM_FROZEN',
          'Claim options are frozen after processing starts.',
          409,
        );
      }
      const [campaign] = await transaction
        .select({ claimFormSchema: giftCampaigns.claimFormSchema })
        .from(giftCampaigns)
        .where(eq(giftCampaigns.id, claim.campaignId));
      const normalized = normalizeClaimOptions(campaign!.claimFormSchema, optionValues);
      await transaction.delete(claimOptionValues).where(eq(claimOptionValues.claimId, claim.id));
      if (Object.keys(normalized).length > 0) {
        await transaction.insert(claimOptionValues).values(
          Object.entries(normalized).map(([fieldKey, value]) => ({
            claimId: claim.id,
            fieldKey,
            ...encryptedColumns(
              this.encryption.encrypt({ value }, `claim-option:${claim.id}:${fieldKey}`),
            ),
          })),
        );
      }
      const now = await this.databaseNow(transaction);
      const [updated] = await transaction
        .update(claims)
        .set({ updatedAt: now, version: sql`${claims.version} + 1` })
        .where(eq(claims.id, claim.id))
        .returning();
      await this.audit.record(
        {
          action: 'claim.options-updated',
          actorUserId: userId,
          afterSummary: { fieldCount: Object.keys(normalized).length, version: updated!.version },
          creatorId: claim.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: claim.organizationId,
          requestId: context.requestId ?? null,
          targetId: claim.id,
          targetType: 'claim',
        },
        transaction,
      );
      return summary(updated!);
    });
  }

  public async userTransition(
    userId: string,
    claimId: string,
    input: {
      readonly reason?: string | undefined;
      readonly target: 'CANCELLED' | 'COMPLETED';
      readonly version: number;
    },
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const claim = await this.lockOwnedClaim(transaction, userId, claimId, input.version);
      if (!canTransitionClaim(claim.status as ClaimStatus, input.target, 'USER')) {
        throw new AppError('CLAIM_TRANSITION_INVALID', 'The claim transition is not allowed.', 409);
      }
      const now = await this.databaseNow(transaction);
      if (input.target === 'CANCELLED') {
        const [campaign] = await transaction
          .select({ deadline: giftCampaigns.claimDeadlineAt })
          .from(giftCampaigns)
          .where(eq(giftCampaigns.id, claim.campaignId));
        if (!campaign || now > campaign.deadline) {
          throw new AppError('CLAIM_DEADLINE_PASSED', 'The claim deadline has passed.', 410);
        }
        if (!input.reason?.trim() || input.reason.trim().length < 3) {
          throw new AppError(
            'CLAIM_CANCEL_REASON_REQUIRED',
            'A cancellation reason is required.',
            400,
          );
        }
      }
      const [updated] = await transaction
        .update(claims)
        .set({
          ...(input.target === 'CANCELLED'
            ? { cancelReason: input.reason!.trim(), cancelledAt: now }
            : { completedAt: now }),
          status: input.target,
          updatedAt: now,
          version: sql`${claims.version} + 1`,
        })
        .where(eq(claims.id, claim.id))
        .returning();
      await transaction.insert(claimStatusHistory).values({
        actorUserId: userId,
        claimId: claim.id,
        fromStatus: claim.status,
        reason: input.reason?.trim() || null,
        toStatus: input.target,
      });
      await this.recordTransition(claim, updated!, context, transaction, input.reason);
      return summary(updated!);
    });
  }

  public async operatorTransition(
    claimId: string,
    input: {
      readonly reason?: string | undefined;
      readonly target: 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
      readonly version: number;
    },
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [claim] = await transaction
        .select()
        .from(claims)
        .where(eq(claims.id, claimId))
        .limit(1)
        .for('update');
      if (!claim) throw new AppError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
      if (claim.version !== input.version) {
        throw new AppError('CLAIM_VERSION_CONFLICT', 'The claim changed before this request.', 409);
      }
      if (!canTransitionClaim(claim.status as ClaimStatus, input.target, 'OPERATOR')) {
        throw new AppError('CLAIM_TRANSITION_INVALID', 'The claim transition is not allowed.', 409);
      }
      if (
        input.target === 'CANCELLED' &&
        (!input.reason?.trim() || input.reason.trim().length < 3)
      ) {
        throw new AppError(
          'CLAIM_CANCEL_REASON_REQUIRED',
          'A cancellation reason is required.',
          400,
        );
      }
      const now = await this.databaseNow(transaction);
      const [updated] = await transaction
        .update(claims)
        .set({
          ...(input.target === 'PROCESSING' ? { processingAt: now } : {}),
          ...(input.target === 'SHIPPED' ? { shippedAt: now } : {}),
          ...(input.target === 'COMPLETED' ? { completedAt: now } : {}),
          ...(input.target === 'CANCELLED'
            ? { cancelReason: input.reason!.trim(), cancelledAt: now }
            : {}),
          status: input.target,
          updatedAt: now,
          version: sql`${claims.version} + 1`,
        })
        .where(eq(claims.id, claim.id))
        .returning();
      await transaction.insert(claimStatusHistory).values({
        actorUserId: context.actorUserId,
        claimId: claim.id,
        fromStatus: claim.status,
        reason: input.reason?.trim() || null,
        toStatus: input.target,
      });
      await this.recordTransition(claim, updated!, context, transaction, input.reason);
      return summary(updated!);
    });
  }

  private async recordTransition(
    before: typeof claims.$inferSelect,
    after: typeof claims.$inferSelect,
    context: RequestAuditContext,
    executor: AppDatabase,
    reason?: string,
  ) {
    await this.audit.record(
      {
        action: 'claim.transitioned',
        actorUserId: context.actorUserId,
        afterSummary: { status: after.status, version: after.version },
        beforeSummary: { status: before.status, version: before.version },
        creatorId: after.creatorId,
        ipAddress: context.ipAddress ?? null,
        organizationId: after.organizationId,
        reason: reason?.trim() || null,
        requestId: context.requestId ?? null,
        targetId: after.id,
        targetType: 'claim',
      },
      executor,
    );
  }

  public async listForOrganization(organizationId: string, allowedCreatorIds?: readonly string[]) {
    const condition =
      allowedCreatorIds && allowedCreatorIds.length > 0
        ? and(
            eq(claims.organizationId, organizationId),
            inArray(claims.creatorId, [...allowedCreatorIds]),
          )
        : eq(claims.organizationId, organizationId);
    const rows = await this.database.orm
      .select({ claim: claims, campaignTitle: giftCampaigns.title })
      .from(claims)
      .innerJoin(giftCampaigns, eq(giftCampaigns.id, claims.campaignId))
      .where(condition)
      .orderBy(desc(claims.updatedAt));
    return rows.map((row) => ({ ...summary(row.claim), campaignTitle: row.campaignTitle }));
  }

  public async batchProcess(
    organizationId: string,
    claimIds: readonly string[],
    allowedCreatorIds: readonly string[],
    idempotencyKey: string,
    context: RequestAuditContext,
  ) {
    const uniqueIds = [...new Set(claimIds)].sort();
    if (uniqueIds.length !== claimIds.length || uniqueIds.length < 1 || uniqueIds.length > 100) {
      throw new AppError(
        'CLAIM_BATCH_INVALID',
        'Claim batch must contain 1 to 100 unique IDs.',
        400,
      );
    }
    const requestHash = idempotencyRequestHash({ claimIds: uniqueIds });
    return this.database.orm.transaction(async (transaction) => {
      const now = await this.databaseNow(transaction);
      const idempotency = await this.beginIdempotency(transaction, {
        actorUserId: context.actorUserId,
        key: idempotencyKey,
        now,
        requestHash,
        scope: `claim-batch-processing:${organizationId}`,
      });
      if (idempotency.replay) return idempotency.replay;
      const rows = await transaction
        .select()
        .from(claims)
        .where(inArray(claims.id, uniqueIds))
        .orderBy(asc(claims.id))
        .for('update');
      if (
        rows.length !== uniqueIds.length ||
        rows.some(
          (claim) =>
            claim.organizationId !== organizationId ||
            claim.status !== 'SUBMITTED' ||
            (allowedCreatorIds.length > 0 && !allowedCreatorIds.includes(claim.creatorId)),
        )
      ) {
        throw new AppError(
          'CLAIM_BATCH_CONFLICT',
          'Every batch claim must be an accessible submitted claim.',
          409,
        );
      }
      for (const claim of rows) {
        await transaction
          .update(claims)
          .set({
            processingAt: now,
            status: 'PROCESSING',
            updatedAt: now,
            version: sql`${claims.version} + 1`,
          })
          .where(eq(claims.id, claim.id));
        await transaction.insert(claimStatusHistory).values({
          actorUserId: context.actorUserId,
          claimId: claim.id,
          fromStatus: 'SUBMITTED',
          toStatus: 'PROCESSING',
        });
      }
      const result = { processedClaimIds: rows.map((claim) => claim.id) };
      await this.completeIdempotency(transaction, idempotency.id, result);
      await this.audit.record(
        {
          action: 'claim.batch-processing',
          actorUserId: context.actorUserId,
          afterSummary: { count: rows.length },
          ipAddress: context.ipAddress ?? null,
          organizationId,
          requestId: context.requestId ?? null,
          targetId: idempotency.id,
          targetType: 'claim-batch',
        },
        transaction,
      );
      return result;
    });
  }

  public async assertOrganizationAccess(
    session: AuthSession,
    organizationId: string,
    permission: OrganizationPermission,
  ) {
    if (session.user.platformRole === 'PLATFORM_ADMIN') return { creatorIds: [] as string[] };
    const [membership] = await this.database.orm
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, session.user.id),
        ),
      )
      .limit(1);
    if (
      !membership ||
      !isOrganizationRole(membership.role) ||
      !hasOrganizationPermission(membership.role, permission)
    ) {
      throw new AppError('CLAIM_ACCESS_DENIED', 'Claim access denied.', 403);
    }
    const scopes = await this.database.orm
      .select({ creatorId: memberCreatorScopes.creatorId })
      .from(memberCreatorScopes)
      .where(eq(memberCreatorScopes.memberId, membership.id));
    return { creatorIds: scopes.map((scope) => scope.creatorId) };
  }

  public async assertClaimAccess(
    session: AuthSession,
    claimId: string,
    permission: OrganizationPermission,
  ) {
    const [claim] = await this.database.orm
      .select({ creatorId: claims.creatorId, organizationId: claims.organizationId })
      .from(claims)
      .where(eq(claims.id, claimId))
      .limit(1);
    if (!claim) throw new AppError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
    const access = await this.assertOrganizationAccess(session, claim.organizationId, permission);
    if (access.creatorIds.length > 0 && !access.creatorIds.includes(claim.creatorId)) {
      throw new AppError('CLAIM_ACCESS_DENIED', 'Claim access denied.', 403);
    }
    return claim;
  }
}
