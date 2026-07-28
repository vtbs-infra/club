import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import {
  hasOrganizationPermission,
  isOrganizationRole,
  type OrganizationPermission,
} from '../../../shared/permissions/permissions.js';
import { SystemClock, type Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  claimAddresses,
  claimEntitlements,
  claims,
  claimStatusHistory,
  creators,
  entitlements,
  giftCampaigns,
  giftPackages,
  memberCreatorScopes,
  organizationMembers,
  shipmentItems,
  shipments,
  snapshotMembers,
  trackingEvents,
} from '../../infrastructure/db/schema.js';
import type { EncryptionKeyRing } from '../../infrastructure/encryption/key-ring.js';
import { isAddressPayload, type AddressPayload } from '../addresses/address-domain.js';
import { AuditService } from '../audit/audit-service.js';
import type { AuthSession } from '../auth/auth.js';
import { relevantMonthlyPeriods } from '../snapshots/month-end.js';
import {
  FULFILLMENT_CSV_VERSION,
  IMPORT_COLUMNS,
  parseImportCsv,
  serializeCsv,
  validateTrackingUrl,
} from './fulfillment-domain.js';
import {
  buildGuardAddressWorkbook,
  type GuardAddressWorkbookRow,
  type GuardTier,
} from './guard-address-workbook.js';
import type { ShipmentStatus, TrackingProvider, TrackingResult } from './tracking-provider.js';

export interface FulfillmentFilters {
  readonly campaignId?: string | undefined;
  readonly creatorId?: string | undefined;
  readonly periodStart?: string | undefined;
  readonly status?: string | undefined;
}

export interface CreateShipmentInput {
  readonly carrierCode: string;
  readonly claimEntitlementIds?: readonly string[] | undefined;
  readonly shipmentKey: string;
  readonly trackingNumber: string;
  readonly trackingUrl?: string | null | undefined;
}

export interface FulfillmentAccess {
  readonly creatorIds: readonly string[];
}

export interface FulfillmentAuditContext {
  readonly actorUserId: string | null;
  readonly ipAddress?: string | null | undefined;
  readonly requestId?: string | null | undefined;
}

const EXPORT_COLUMNS = [
  'format_version',
  'claim_number',
  'claim_id',
  'campaign_title',
  'creator_id',
  'period_start',
  'claim_status',
  'recipient_name',
  'phone',
  'country_region',
  'province',
  'city',
  'district',
  'detailed_address',
  'postal_code',
  'user_note',
  'claim_entitlement_ids',
  'package_names',
  'shipment_key',
  'carrier_code',
  'tracking_number',
  'tracking_url',
] as const;

function shipmentSummary(row: typeof shipments.$inferSelect) {
  return {
    carrierCode: row.carrierCode,
    claimId: row.claimId,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    exceptionMessage: row.exceptionMessage,
    id: row.id,
    lastTrackingRefreshAt: row.lastTrackingRefreshAt?.toISOString() ?? null,
    nextTrackingRefreshAt: row.nextTrackingRefreshAt?.toISOString() ?? null,
    shipmentKey: row.shipmentKey,
    shipmentNumber: row.shipmentNumber,
    status: row.status as ShipmentStatus,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizedIdentity(input: CreateShipmentInput) {
  const shipmentKey = input.shipmentKey.trim();
  const carrierCode = input.carrierCode.trim().toLowerCase();
  const trackingNumber = input.trackingNumber.trim();
  if (!shipmentKey || shipmentKey.length > 120) {
    throw new AppError('SHIPMENT_KEY_INVALID', 'Shipment key is required.', 400);
  }
  if (!carrierCode || carrierCode.length > 80) {
    throw new AppError('SHIPMENT_CARRIER_INVALID', 'Carrier code is required.', 400);
  }
  if (!trackingNumber || trackingNumber.length > 160) {
    throw new AppError('SHIPMENT_TRACKING_NUMBER_INVALID', 'Tracking number is required.', 400);
  }
  return {
    carrierCode,
    shipmentKey,
    trackingNumber,
    trackingUrl: validateTrackingUrl(input.trackingUrl),
  };
}

function sameSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export class FulfillmentService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
    private readonly trackingProvider: TrackingProvider | null,
    private readonly clock: Clock = new SystemClock(),
  ) {
    this.audit = new AuditService(database);
  }

  private async databaseNow(executor: AppDatabase): Promise<Date> {
    const [row] = await executor.execute<{ value: Date | string }>(sql`select now() as value`);
    return row!.value instanceof Date ? row!.value : new Date(row!.value);
  }

  public async assertOrganizationAccess(
    session: AuthSession,
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<FulfillmentAccess> {
    if (session.user.platformRole === 'PLATFORM_ADMIN') return { creatorIds: [] };
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
      throw new AppError('FULFILLMENT_ACCESS_DENIED', 'Fulfillment access denied.', 403);
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
    if (access.creatorIds.length && !access.creatorIds.includes(claim.creatorId)) {
      throw new AppError('FULFILLMENT_ACCESS_DENIED', 'Fulfillment access denied.', 403);
    }
    return { ...access, ...claim };
  }

  public async assertShipmentAccess(
    session: AuthSession,
    shipmentId: string,
    permission: OrganizationPermission,
  ) {
    const [shipment] = await this.database.orm
      .select({ creatorId: shipments.creatorId, organizationId: shipments.organizationId })
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new AppError('SHIPMENT_NOT_FOUND', 'Shipment not found.', 404);
    const access = await this.assertOrganizationAccess(
      session,
      shipment.organizationId,
      permission,
    );
    if (access.creatorIds.length && !access.creatorIds.includes(shipment.creatorId)) {
      throw new AppError('FULFILLMENT_ACCESS_DENIED', 'Fulfillment access denied.', 403);
    }
    return shipment;
  }

  public async listClaims(
    organizationId: string,
    allowedCreatorIds: readonly string[],
    filters: FulfillmentFilters,
  ) {
    const conditions = [eq(claims.organizationId, organizationId)];
    if (allowedCreatorIds.length)
      conditions.push(inArray(claims.creatorId, [...allowedCreatorIds]));
    if (filters.creatorId) conditions.push(eq(claims.creatorId, filters.creatorId));
    if (filters.campaignId) conditions.push(eq(claims.campaignId, filters.campaignId));
    if (filters.status) conditions.push(eq(claims.status, filters.status));
    if (filters.periodStart) conditions.push(eq(giftCampaigns.periodStart, filters.periodStart));
    const rows = await this.database.orm
      .select({ campaign: giftCampaigns, claim: claims })
      .from(claims)
      .innerJoin(giftCampaigns, eq(giftCampaigns.id, claims.campaignId))
      .where(and(...conditions))
      .orderBy(desc(claims.updatedAt));
    const claimIds = rows.map((row) => row.claim.id);
    const shipmentRows = claimIds.length
      ? await this.database.orm
          .select()
          .from(shipments)
          .where(inArray(shipments.claimId, claimIds))
          .orderBy(asc(shipments.createdAt))
      : [];
    return rows.map(({ campaign, claim }) => ({
      biliUid: claim.biliUid,
      campaignId: claim.campaignId,
      campaignTitle: campaign.title,
      claimNumber: claim.claimNumber,
      creatorId: claim.creatorId,
      id: claim.id,
      periodStart: campaign.periodStart,
      shipments: shipmentRows
        .filter((shipment) => shipment.claimId === claim.id)
        .map(shipmentSummary),
      status: claim.status,
      updatedAt: claim.updatedAt.toISOString(),
      version: claim.version,
    }));
  }

  private decryptAddress(claimId: string, row: typeof claimAddresses.$inferSelect) {
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
      if (!isAddressPayload(payload)) throw new Error('invalid address');
      return payload;
    } catch {
      throw new AppError(
        'FULFILLMENT_ADDRESS_DECRYPTION_FAILED',
        'An encrypted fulfillment address could not be read with the configured key ring.',
        500,
      );
    }
  }

  public async exportClaims(
    organizationId: string,
    allowedCreatorIds: readonly string[],
    filters: FulfillmentFilters,
    context: FulfillmentAuditContext,
  ) {
    const listed = await this.listClaims(organizationId, allowedCreatorIds, filters);
    if (!listed.length) return serializeCsv([EXPORT_COLUMNS]);
    return this.database.orm.transaction(async (transaction) => {
      const claimIds = listed.map((claim) => claim.id);
      const [addressRows, packageRows] = await Promise.all([
        transaction.select().from(claimAddresses).where(inArray(claimAddresses.claimId, claimIds)),
        transaction
          .select({
            claimEntitlementId: claimEntitlements.id,
            claimId: claimEntitlements.claimId,
            packageName: giftPackages.name,
          })
          .from(claimEntitlements)
          .innerJoin(entitlements, eq(entitlements.id, claimEntitlements.entitlementId))
          .innerJoin(giftPackages, eq(giftPackages.id, entitlements.giftPackageId))
          .where(inArray(claimEntitlements.claimId, claimIds)),
      ]);
      const rows: (string | number | null)[][] = [Array.from(EXPORT_COLUMNS)];
      for (const claim of listed) {
        const addressRow = addressRows.find((candidate) => candidate.claimId === claim.id);
        if (!addressRow) {
          throw new AppError(
            'FULFILLMENT_ADDRESS_NOT_FOUND',
            'A claim is missing its delivery snapshot.',
            409,
          );
        }
        const address = this.decryptAddress(claim.id, addressRow);
        const packages = packageRows.filter((item) => item.claimId === claim.id);
        rows.push([
          FULFILLMENT_CSV_VERSION,
          claim.claimNumber,
          claim.id,
          claim.campaignTitle,
          claim.creatorId,
          claim.periodStart,
          claim.status,
          address.recipientName,
          address.phone,
          address.countryRegion,
          address.province,
          address.city,
          address.district,
          address.detailedAddress,
          address.postalCode,
          address.userNote,
          packages.map((item) => item.claimEntitlementId).join(';'),
          packages.map((item) => item.packageName).join(';'),
          '',
          '',
          '',
          '',
        ]);
        await this.audit.record(
          {
            action: 'fulfillment.address-exported',
            actorUserId: context.actorUserId,
            afterSummary: { formatVersion: FULFILLMENT_CSV_VERSION },
            creatorId: claim.creatorId,
            ipAddress: context.ipAddress ?? null,
            organizationId,
            requestId: context.requestId ?? null,
            targetId: claim.id,
            targetType: 'claim',
          },
          transaction,
        );
      }
      await this.audit.record(
        {
          action: 'fulfillment.csv-exported',
          actorUserId: context.actorUserId,
          afterSummary: { claimCount: listed.length, formatVersion: FULFILLMENT_CSV_VERSION },
          ipAddress: context.ipAddress ?? null,
          organizationId,
          requestId: context.requestId ?? null,
          targetId: organizationId,
          targetType: 'organization',
        },
        transaction,
      );
      return serializeCsv(rows);
    });
  }

  public async exportCurrentMonthGuardAddresses(
    organizationId: string,
    creatorId: string,
    allowedCreatorIds: readonly string[],
    context: FulfillmentAuditContext,
  ) {
    if (allowedCreatorIds.length > 0 && !allowedCreatorIds.includes(creatorId)) {
      throw new AppError('FULFILLMENT_ACCESS_DENIED', 'Fulfillment access denied.', 403);
    }
    const [creator] = await this.database.orm
      .select({
        displayName: creators.displayName,
        id: creators.id,
        timezone: creators.timezone,
      })
      .from(creators)
      .where(
        and(
          eq(creators.id, creatorId),
          eq(creators.organizationId, organizationId),
          isNull(creators.archivedAt),
        ),
      )
      .limit(1);
    if (!creator) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);

    const generatedAt = this.clock.now();
    const periodStart = relevantMonthlyPeriods(generatedAt, creator.timezone)[0];
    const result = await this.database.orm.transaction(async (transaction) => {
      const sourceRows = await transaction
        .select({
          address: claimAddresses,
          biliUid: claims.biliUid,
          claimId: claims.id,
          claimNumber: claims.claimNumber,
          claimStatus: claims.status,
          displayName: snapshotMembers.displayNameAtSnapshot,
          sourcePosition: snapshotMembers.sourcePosition,
          tier: entitlements.tier,
        })
        .from(claims)
        .innerJoin(giftCampaigns, eq(giftCampaigns.id, claims.campaignId))
        .innerJoin(claimAddresses, eq(claimAddresses.claimId, claims.id))
        .innerJoin(claimEntitlements, eq(claimEntitlements.claimId, claims.id))
        .innerJoin(entitlements, eq(entitlements.id, claimEntitlements.entitlementId))
        .innerJoin(snapshotMembers, eq(snapshotMembers.id, entitlements.snapshotMemberId))
        .where(
          and(
            eq(claims.organizationId, organizationId),
            eq(claims.creatorId, creatorId),
            eq(giftCampaigns.periodStart, periodStart),
            ne(claims.status, 'CANCELLED'),
            isNull(entitlements.revokedAt),
          ),
        )
        .orderBy(asc(snapshotMembers.sourcePosition), asc(claims.claimNumber));

      const uniqueRows = new Map<
        string,
        (typeof sourceRows)[number] & { readonly tier: GuardTier }
      >();
      for (const row of sourceRows) {
        if (row.tier !== 'CAPTAIN' && row.tier !== 'ADMIRAL' && row.tier !== 'GOVERNOR') {
          throw new AppError(
            'FULFILLMENT_GUARD_TIER_INVALID',
            'A guard record contains an unsupported tier.',
            500,
          );
        }
        if (!uniqueRows.has(row.claimId)) uniqueRows.set(row.claimId, { ...row, tier: row.tier });
      }

      const workbookRows: GuardAddressWorkbookRow[] = [];
      for (const row of uniqueRows.values()) {
        workbookRows.push({
          address: this.decryptAddress(row.claimId, row.address),
          biliUid: row.biliUid,
          claimNumber: row.claimNumber,
          claimStatus: row.claimStatus,
          displayName: row.displayName,
          tier: row.tier,
        });
      }
      const content = await buildGuardAddressWorkbook({
        creatorDisplayName: creator.displayName,
        generatedAt,
        periodStart,
        rows: workbookRows,
        timezone: creator.timezone,
      });

      for (const row of uniqueRows.values()) {
        await this.audit.record(
          {
            action: 'fulfillment.address-exported',
            actorUserId: context.actorUserId,
            afterSummary: {
              format: 'xlsx',
              periodStart,
              source: 'current-month-guard-export',
            },
            creatorId,
            ipAddress: context.ipAddress ?? null,
            organizationId,
            requestId: context.requestId ?? null,
            targetId: row.claimId,
            targetType: 'claim',
          },
          transaction,
        );
      }
      await this.audit.record(
        {
          action: 'fulfillment.guard-xlsx-exported',
          actorUserId: context.actorUserId,
          afterSummary: { periodStart, rowCount: workbookRows.length },
          creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId,
          requestId: context.requestId ?? null,
          targetId: creatorId,
          targetType: 'creator',
        },
        transaction,
      );
      return { content, rowCount: workbookRows.length };
    });
    return {
      ...result,
      creatorDisplayName: creator.displayName,
      periodStart,
    };
  }

  public exportTemplate() {
    return serializeCsv([
      IMPORT_COLUMNS,
      [FULFILLMENT_CSV_VERSION, 'CLM-2026-00000001', 'box-1', 'manual', 'TRACK123', '', ''],
    ]);
  }

  private async nextShipmentNumber(executor: AppDatabase, now: Date) {
    const [row] = await executor.execute<{ value: string }>(
      sql`select nextval('shipment_number_sequence')::text as value`,
    );
    return `SHP-${now.getUTCFullYear()}-${row!.value.padStart(8, '0')}`;
  }

  private async detail(executor: AppDatabase, shipmentId: string) {
    const [shipment] = await executor
      .select()
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new AppError('SHIPMENT_NOT_FOUND', 'Shipment not found.', 404);
    const [items, events] = await Promise.all([
      executor
        .select({ claimEntitlementId: shipmentItems.claimEntitlementId })
        .from(shipmentItems)
        .where(eq(shipmentItems.shipmentId, shipment.id))
        .orderBy(asc(shipmentItems.createdAt)),
      executor
        .select()
        .from(trackingEvents)
        .where(eq(trackingEvents.shipmentId, shipment.id))
        .orderBy(desc(trackingEvents.occurredAt)),
    ]);
    return {
      ...shipmentSummary(shipment),
      claimEntitlementIds: items.map((item) => item.claimEntitlementId),
      events: events.map((event) => ({
        description: event.description,
        id: event.id,
        location: event.location,
        occurredAt: event.occurredAt.toISOString(),
        status: event.status,
      })),
    };
  }

  public async createShipment(
    claimId: string,
    input: CreateShipmentInput,
    context: FulfillmentAuditContext,
  ) {
    const identity = normalizedIdentity(input);
    const requestedIds = [...new Set(input.claimEntitlementIds ?? [])];
    if (requestedIds.length !== (input.claimEntitlementIds?.length ?? 0)) {
      throw new AppError(
        'SHIPMENT_ITEMS_INVALID',
        'Shipment item IDs must not contain duplicates.',
        400,
      );
    }
    return this.database.orm.transaction(async (transaction) => {
      const [claim] = await transaction
        .select()
        .from(claims)
        .where(eq(claims.id, claimId))
        .limit(1)
        .for('update');
      if (!claim) throw new AppError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
      if (claim.status !== 'PROCESSING' && claim.status !== 'SHIPPED') {
        throw new AppError(
          'CLAIM_NOT_READY_FOR_SHIPMENT',
          'Claim must be processing before shipment creation.',
          409,
        );
      }
      const [existing] = await transaction
        .select()
        .from(shipments)
        .where(
          and(eq(shipments.claimId, claim.id), eq(shipments.shipmentKey, identity.shipmentKey)),
        )
        .limit(1);
      if (existing) {
        const existingDetail = await this.detail(transaction, existing.id);
        const identityMatches =
          existing.carrierCode === identity.carrierCode &&
          existing.trackingNumber === identity.trackingNumber &&
          existing.trackingUrl ===
            (identity.trackingUrl ??
              this.trackingProvider?.buildPublicUrl?.(
                identity.carrierCode,
                identity.trackingNumber,
              ) ??
              null);
        const itemsMatch =
          requestedIds.length === 0 || sameSet(existingDetail.claimEntitlementIds, requestedIds);
        if (!identityMatches || !itemsMatch) {
          throw new AppError(
            'SHIPMENT_IDENTITY_CONFLICT',
            'Shipment key already identifies different shipment data.',
            409,
          );
        }
        return { replayed: true, shipment: existingDetail };
      }

      const claimLinks = await transaction
        .select({ id: claimEntitlements.id })
        .from(claimEntitlements)
        .where(eq(claimEntitlements.claimId, claim.id))
        .orderBy(asc(claimEntitlements.createdAt));
      const allIds = claimLinks.map((link) => link.id);
      const assigned = allIds.length
        ? await transaction
            .select({ id: shipmentItems.claimEntitlementId })
            .from(shipmentItems)
            .where(inArray(shipmentItems.claimEntitlementId, allIds))
        : [];
      const assignedIds = new Set(assigned.map((item) => item.id));
      const unassignedIds = allIds.filter((id) => !assignedIds.has(id));
      const itemIds = requestedIds.length ? requestedIds : unassignedIds;
      if (
        itemIds.length === 0 ||
        itemIds.some((id) => !allIds.includes(id) || assignedIds.has(id))
      ) {
        throw new AppError(
          'SHIPMENT_ITEMS_INVALID',
          'Shipment items must be unassigned entitlements from this claim.',
          409,
        );
      }

      const now = await this.databaseNow(transaction);
      const trackingUrl =
        identity.trackingUrl ??
        this.trackingProvider?.buildPublicUrl?.(identity.carrierCode, identity.trackingNumber) ??
        null;
      const [shipment] = await transaction
        .insert(shipments)
        .values({
          carrierCode: identity.carrierCode,
          claimId: claim.id,
          creatorId: claim.creatorId,
          nextTrackingRefreshAt: this.trackingProvider
            ? new Date(now.getTime() + 15 * 60_000)
            : null,
          organizationId: claim.organizationId,
          shipmentKey: identity.shipmentKey,
          shipmentNumber: await this.nextShipmentNumber(transaction, now),
          trackingNumber: identity.trackingNumber,
          trackingUrl,
        })
        .returning();
      await transaction.insert(shipmentItems).values(
        itemIds.map((claimEntitlementId) => ({
          claimEntitlementId,
          shipmentId: shipment!.id,
        })),
      );
      await transaction.insert(trackingEvents).values({
        description: 'Shipment information created',
        occurredAt: now,
        providerEventId: `manual:${shipment!.id}:created`,
        shipmentId: shipment!.id,
        status: 'LABEL_CREATED',
      });

      const allAssigned = assignedIds.size + itemIds.length === allIds.length;
      if (claim.status === 'PROCESSING' && allAssigned) {
        const [updatedClaim] = await transaction
          .update(claims)
          .set({
            shippedAt: now,
            status: 'SHIPPED',
            updatedAt: now,
            version: sql`${claims.version} + 1`,
          })
          .where(eq(claims.id, claim.id))
          .returning();
        await transaction.insert(claimStatusHistory).values({
          actorUserId: context.actorUserId,
          claimId: claim.id,
          fromStatus: 'PROCESSING',
          toStatus: 'SHIPPED',
        });
        await this.audit.record(
          {
            action: 'claim.transitioned',
            actorUserId: context.actorUserId,
            afterSummary: { status: 'SHIPPED', version: updatedClaim!.version },
            beforeSummary: { status: 'PROCESSING', version: claim.version },
            creatorId: claim.creatorId,
            ipAddress: context.ipAddress ?? null,
            organizationId: claim.organizationId,
            requestId: context.requestId ?? null,
            targetId: claim.id,
            targetType: 'claim',
          },
          transaction,
        );
      }
      await this.audit.record(
        {
          action: 'shipment.created',
          actorUserId: context.actorUserId,
          afterSummary: {
            carrierCode: shipment!.carrierCode,
            itemCount: itemIds.length,
            shipmentKey: shipment!.shipmentKey,
          },
          creatorId: claim.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: claim.organizationId,
          requestId: context.requestId ?? null,
          targetId: shipment!.id,
          targetType: 'shipment',
        },
        transaction,
      );
      return { replayed: false, shipment: await this.detail(transaction, shipment!.id) };
    });
  }

  public async listForUser(userId: string, claimId: string) {
    const [claim] = await this.database.orm
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.userId, userId)))
      .limit(1);
    if (!claim) throw new AppError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
    const rows = await this.database.orm
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.claimId, claim.id))
      .orderBy(asc(shipments.createdAt));
    return Promise.all(rows.map((row) => this.detail(this.database.orm, row.id)));
  }

  public async getClaimFulfillment(claimId: string, context: FulfillmentAuditContext) {
    const [claim] = await this.database.orm
      .select()
      .from(claims)
      .where(eq(claims.id, claimId))
      .limit(1);
    if (!claim) throw new AppError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
    const [address] = await this.database.orm
      .select()
      .from(claimAddresses)
      .where(eq(claimAddresses.claimId, claim.id))
      .limit(1);
    if (!address) {
      throw new AppError(
        'FULFILLMENT_ADDRESS_NOT_FOUND',
        'A claim is missing its delivery snapshot.',
        409,
      );
    }
    const shipmentRows = await this.database.orm
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.claimId, claim.id))
      .orderBy(asc(shipments.createdAt));
    await this.audit.record({
      action: 'fulfillment.address-read',
      actorUserId: context.actorUserId,
      afterSummary: { source: 'fulfillment-detail' },
      creatorId: claim.creatorId,
      ipAddress: context.ipAddress ?? null,
      organizationId: claim.organizationId,
      requestId: context.requestId ?? null,
      targetId: claim.id,
      targetType: 'claim',
    });
    return {
      address: this.decryptAddress(claim.id, address),
      claim: {
        claimNumber: claim.claimNumber,
        id: claim.id,
        status: claim.status,
        version: claim.version,
      },
      shipments: await Promise.all(
        shipmentRows.map((row) => this.detail(this.database.orm, row.id)),
      ),
    };
  }

  private async applyTrackingResult(
    shipmentId: string,
    result: TrackingResult,
    context: FulfillmentAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .limit(1)
        .for('update');
      if (!before) throw new AppError('SHIPMENT_NOT_FOUND', 'Shipment not found.', 404);
      const now = await this.databaseNow(transaction);
      for (const event of result.events) {
        await transaction
          .insert(trackingEvents)
          .values({
            description: event.description.slice(0, 1_000),
            location: event.location?.slice(0, 300) ?? null,
            occurredAt: event.occurredAt,
            providerEventId: event.id.slice(0, 300),
            shipmentId,
            status: event.status,
          })
          .onConflictDoNothing();
      }
      const [updated] = await transaction
        .update(shipments)
        .set({
          deliveredAt: result.status === 'DELIVERED' ? (before.deliveredAt ?? now) : null,
          exceptionMessage:
            result.status === 'EXCEPTION'
              ? (result.events.at(-1)?.description ?? 'Tracking exception').slice(0, 1_000)
              : null,
          lastTrackingRefreshAt: now,
          nextTrackingRefreshAt: result.nextRefreshAt,
          status: result.status,
          trackingUrl: result.publicUrl ?? before.trackingUrl,
          updatedAt: now,
        })
        .where(eq(shipments.id, shipmentId))
        .returning();
      await this.audit.record(
        {
          action: 'shipment.tracking-refreshed',
          actorUserId: context.actorUserId,
          afterSummary: { eventCount: result.events.length, status: updated!.status },
          beforeSummary: { status: before.status },
          creatorId: before.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: before.organizationId,
          requestId: context.requestId ?? null,
          targetId: shipmentId,
          targetType: 'shipment',
        },
        transaction,
      );
      return this.detail(transaction, shipmentId);
    });
  }

  public async refreshShipment(shipmentId: string, context: FulfillmentAuditContext) {
    if (!this.trackingProvider) {
      throw new AppError(
        'TRACKING_PROVIDER_NOT_CONFIGURED',
        'No automatic tracking provider is configured; use the public tracking URL.',
        409,
      );
    }
    const [shipment] = await this.database.orm
      .select()
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new AppError('SHIPMENT_NOT_FOUND', 'Shipment not found.', 404);
    const result = await this.trackingProvider.query(shipment.carrierCode, shipment.trackingNumber);
    return this.applyTrackingResult(shipment.id, result, context);
  }

  public async refreshDue(limit = 50) {
    if (!this.trackingProvider) return { refreshed: 0 };
    const now = await this.databaseNow(this.database.orm);
    const due = await this.database.orm
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(ne(shipments.status, 'DELIVERED'), lte(shipments.nextTrackingRefreshAt, now)))
      .orderBy(asc(shipments.nextTrackingRefreshAt))
      .limit(limit);
    let refreshed = 0;
    for (const shipment of due) {
      try {
        await this.refreshShipment(shipment.id, { actorUserId: null });
        refreshed += 1;
      } catch {
        // One provider failure must not prevent other due shipments from refreshing.
      }
    }
    return { refreshed };
  }

  public async importCsv(
    organizationId: string,
    allowedCreatorIds: readonly string[],
    text: string,
    context: FulfillmentAuditContext,
  ) {
    if (text.length > 2_000_000) {
      throw new AppError('SHIPMENT_CSV_TOO_LARGE', 'Shipment CSV exceeds the 2 MB limit.', 413);
    }
    const parsed = parseImportCsv(text);
    if (!parsed.headerValid) {
      throw new AppError(
        'SHIPMENT_CSV_VERSION_UNSUPPORTED',
        'Shipment CSV header does not match format version 1.',
        400,
      );
    }
    const results: {
      code?: string;
      message?: string;
      rowNumber: number;
      shipmentId?: string;
      status: 'ERROR' | 'IMPORTED' | 'UNCHANGED';
    }[] = [];
    for (const row of parsed.rows) {
      try {
        if (!row.validColumnCount) {
          throw new AppError(
            'SHIPMENT_CSV_ROW_INVALID',
            'CSV row has an unexpected number of columns.',
            400,
          );
        }
        if (row.values.format_version !== FULFILLMENT_CSV_VERSION) {
          throw new AppError(
            'SHIPMENT_CSV_VERSION_UNSUPPORTED',
            'CSV row uses an unsupported format version.',
            400,
          );
        }
        const [claim] = await this.database.orm
          .select({ creatorId: claims.creatorId, id: claims.id })
          .from(claims)
          .where(
            and(
              eq(claims.organizationId, organizationId),
              eq(claims.claimNumber, row.values.claim_number),
            ),
          )
          .limit(1);
        if (
          !claim ||
          (allowedCreatorIds.length > 0 && !allowedCreatorIds.includes(claim.creatorId))
        ) {
          throw new AppError(
            'SHIPMENT_IMPORT_CLAIM_NOT_FOUND',
            'Claim number is not accessible in this organization.',
            404,
          );
        }
        const created = await this.createShipment(
          claim.id,
          {
            carrierCode: row.values.carrier_code,
            claimEntitlementIds: row.values.claim_entitlement_ids
              ? row.values.claim_entitlement_ids
                  .split(';')
                  .map((value) => value.trim())
                  .filter(Boolean)
              : undefined,
            shipmentKey: row.values.shipment_key,
            trackingNumber: row.values.tracking_number,
            trackingUrl: row.values.tracking_url,
          },
          context,
        );
        results.push({
          rowNumber: row.rowNumber,
          shipmentId: created.shipment.id,
          status: created.replayed ? 'UNCHANGED' : 'IMPORTED',
        });
      } catch (error) {
        results.push({
          code: error instanceof AppError ? error.code : 'SHIPMENT_IMPORT_ROW_FAILED',
          message:
            error instanceof AppError
              ? error.message
              : 'Shipment row could not be imported safely.',
          rowNumber: row.rowNumber,
          status: 'ERROR',
        });
      }
    }
    await this.audit.record({
      action: 'shipment.csv-imported',
      actorUserId: context.actorUserId,
      afterSummary: {
        errorCount: results.filter((row) => row.status === 'ERROR').length,
        importedCount: results.filter((row) => row.status === 'IMPORTED').length,
        unchangedCount: results.filter((row) => row.status === 'UNCHANGED').length,
      },
      ipAddress: context.ipAddress ?? null,
      organizationId,
      requestId: context.requestId ?? null,
      targetId: organizationId,
      targetType: 'organization',
    });
    return { formatVersion: FULFILLMENT_CSV_VERSION, results };
  }
}
