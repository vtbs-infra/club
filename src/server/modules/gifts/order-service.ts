import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  creators,
  giftOrderAddresses,
  giftOrderItems,
  giftOrderOptionValues,
  giftOrders,
  giftOrderStatusHistory,
  giftReleases,
  shipmentItems,
  shipments,
  trackingEvents,
  type GiftOrderStatus,
} from '../../infrastructure/db/schema.js';
import {
  EncryptionError,
  type EncryptedValue,
  type EncryptionKeyRing,
} from '../../infrastructure/encryption/key-ring.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import type { AddressService } from '../addresses/address-service.js';
import type { AddressPayload } from '../addresses/address-domain.js';
import type { TrackingProvider } from '../fulfillment/tracking-provider.js';

type ClaimValue = boolean | string;

function encryptedColumns(value: EncryptedValue) {
  return {
    authenticationTag: value.authenticationTag,
    ciphertext: value.ciphertext,
    initializationVector: value.initializationVector,
    keyVersion: value.keyVersion,
  };
}

function cleanText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new AppError('SHIPMENT_INVALID', `${label} is invalid.`, 400);
  }
  return normalized;
}

export class GiftOrderService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
    private readonly addresses: AddressService,
    private readonly trackingProvider: TrackingProvider | null,
  ) {
    this.audit = new AuditService(database);
  }

  public async expireClaimable(): Promise<number> {
    const now = new Date();
    return this.database.orm.transaction(async (transaction) => {
      const expired = await transaction
        .update(giftOrders)
        .set({
          expiredAt: now,
          status: 'EXPIRED',
          updatedAt: now,
          version: sql`${giftOrders.version} + 1`,
        })
        .where(and(eq(giftOrders.status, 'CLAIMABLE'), lte(giftOrders.expiresAt, now)))
        .returning({ id: giftOrders.id });
      if (expired.length > 0) {
        await transaction.insert(giftOrderStatusHistory).values(
          expired.map((order) => ({
            fromStatus: 'CLAIMABLE',
            giftOrderId: order.id,
            reason: 'Claim deadline elapsed.',
            toStatus: 'EXPIRED',
          })),
        );
      }
      return expired.length;
    });
  }

  private async activeBinding(userId: string, executor: AppDatabase = this.database.orm) {
    const [binding] = await executor
      .select({
        biliDisplayName: bilibiliBindings.biliDisplayName,
        biliUid: bilibiliBindings.biliUid,
      })
      .from(bilibiliBindings)
      .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
      .limit(1);
    return binding ?? null;
  }

  private async loadRows(condition: SQL | undefined, limit?: number) {
    const query = this.database.orm
      .select({
        creator: {
          displayName: creators.displayName,
          id: creators.id,
        },
        order: giftOrders,
        release: {
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          claimStartAt: giftReleases.claimStartAt,
          coverObjectKey: giftReleases.coverObjectKey,
          description: giftReleases.description,
          eligibilityMonth: giftReleases.eligibilityMonth,
          formFields: giftReleases.formSchema,
          id: giftReleases.id,
          title: giftReleases.title,
        },
      })
      .from(giftOrders)
      .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
      .innerJoin(creators, eq(creators.id, giftOrders.creatorId))
      .where(condition)
      .orderBy(desc(giftOrders.updatedAt));
    return limit === undefined ? query : query.limit(limit);
  }

  private async serializeRows(rows: Awaited<ReturnType<GiftOrderService['loadRows']>>) {
    const orderIds = rows.map((row) => row.order.id);
    if (orderIds.length === 0) return [];
    const orderItems = await this.database.orm
      .select()
      .from(giftOrderItems)
      .where(inArray(giftOrderItems.giftOrderId, orderIds))
      .orderBy(asc(giftOrderItems.sortOrder));
    const shipmentRows = await this.database.orm
      .select()
      .from(shipments)
      .where(inArray(shipments.giftOrderId, orderIds))
      .orderBy(desc(shipments.createdAt));
    const shipmentIds = shipmentRows.map((shipment) => shipment.id);
    const events =
      shipmentIds.length === 0
        ? []
        : await this.database.orm
            .select()
            .from(trackingEvents)
            .where(inArray(trackingEvents.shipmentId, shipmentIds))
            .orderBy(desc(trackingEvents.occurredAt));
    return rows.map(({ creator, order, release }) => ({
      ...order,
      creator,
      items: orderItems
        .filter((item) => item.giftOrderId === order.id)
        .map((item) => ({ id: item.id, ...item.packageSnapshot })),
      release: {
        ...release,
        coverImageUrl: release.coverObjectKey ? `/api/v1/gift-releases/${release.id}/cover` : null,
      },
      shipments: shipmentRows
        .filter((shipment) => shipment.giftOrderId === order.id)
        .map((shipment) => ({
          carrierName: shipment.carrierName,
          createdAt: shipment.createdAt,
          events: events
            .filter((event) => event.shipmentId === shipment.id)
            .map((event) => ({
              description: event.description,
              location: event.location,
              occurredAt: event.occurredAt,
              status: event.status,
            })),
          id: shipment.id,
          status: shipment.status,
          trackingNumber: shipment.trackingNumber,
          trackingUrl: shipment.trackingUrl,
        })),
    }));
  }

  public async listForUser(userId: string, limit?: number) {
    await this.expireClaimable();
    const binding = await this.activeBinding(userId);
    const condition = binding
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
      : eq(giftOrders.userId, userId);
    return this.serializeRows(await this.loadRows(condition, limit));
  }

  public async getForUser(userId: string, orderId: string) {
    await this.expireClaimable();
    const binding = await this.activeBinding(userId);
    const access = binding
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
      : eq(giftOrders.userId, userId);
    const rows = await this.loadRows(and(eq(giftOrders.id, orderId), access));
    const [order] = await this.serializeRows(rows);
    if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
    return order;
  }

  private validateOptions(
    formFields: readonly {
      readonly key: string;
      readonly label: string;
      readonly options?: readonly string[];
      readonly required: boolean;
      readonly type: string;
    }[],
    values: Readonly<Record<string, ClaimValue>>,
  ) {
    const fields = new Map(formFields.map((field) => [field.key, field]));
    for (const key of Object.keys(values)) {
      if (!fields.has(key)) {
        throw new AppError('GIFT_ORDER_OPTIONS_INVALID', 'An unknown claim field was sent.', 400);
      }
    }
    return formFields.flatMap((field) => {
      const value = values[field.key];
      const absent = value === undefined || value === '' || value === false;
      if (field.required && absent) {
        throw new AppError('GIFT_ORDER_OPTIONS_INVALID', `${field.label} is required.`, 400);
      }
      if (absent) return [];
      if (field.type === 'CHECKBOX') {
        if (typeof value !== 'boolean') {
          throw new AppError(
            'GIFT_ORDER_OPTIONS_INVALID',
            `${field.label} must be confirmed.`,
            400,
          );
        }
      } else if (typeof value !== 'string' || value.length > 2_000) {
        throw new AppError('GIFT_ORDER_OPTIONS_INVALID', `${field.label} is invalid.`, 400);
      }
      if (
        (field.type === 'SELECT' || field.type === 'RADIO') &&
        !field.options?.includes(value as string)
      ) {
        throw new AppError('GIFT_ORDER_OPTIONS_INVALID', `${field.label} is invalid.`, 400);
      }
      return [{ field, value }];
    });
  }

  public async submit(
    userId: string,
    orderId: string,
    input: {
      readonly addressId: string;
      readonly expectedVersion: number;
      readonly options: Readonly<Record<string, ClaimValue>>;
    },
    context: RequestAuditContext,
  ) {
    await this.expireClaimable();
    await this.database.orm.transaction(async (transaction) => {
      const [order] = await transaction
        .select()
        .from(giftOrders)
        .where(eq(giftOrders.id, orderId))
        .limit(1)
        .for('update');
      if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
      if (order.status !== 'CLAIMABLE') {
        throw new AppError('GIFT_ORDER_NOT_CLAIMABLE', 'This gift can no longer be claimed.', 409);
      }
      if (order.version !== input.expectedVersion) {
        throw new AppError(
          'GIFT_ORDER_VERSION_CONFLICT',
          'This gift changed. Reload it before submitting.',
          409,
        );
      }
      const binding = await this.activeBinding(userId, transaction);
      if (!binding || binding.biliUid !== order.biliUid) {
        throw new AppError(
          'BILIBILI_BINDING_REQUIRED',
          'Bind the Bilibili UID associated with this gift before claiming it.',
          403,
        );
      }
      const [release] = await transaction
        .select({
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          claimStartAt: giftReleases.claimStartAt,
          formSchema: giftReleases.formSchema,
        })
        .from(giftReleases)
        .where(eq(giftReleases.id, order.giftReleaseId))
        .limit(1);
      const now = new Date();
      if (!release || now < release.claimStartAt || now > release.claimDeadlineAt) {
        throw new AppError(
          'GIFT_ORDER_CLAIM_WINDOW_CLOSED',
          'This gift is outside its claim window.',
          409,
        );
      }
      const optionValues = this.validateOptions(release.formSchema, input.options);
      const address = await this.addresses.getPlaintext(userId, input.addressId, transaction);
      const frozenAddressId = randomUUID();
      await transaction.insert(giftOrderAddresses).values({
        giftOrderId: order.id,
        id: frozenAddressId,
        sourceAddressId: address.row.id,
        ...encryptedColumns(
          this.encryption.encrypt(address.payload, `gift-order-address:${frozenAddressId}`),
        ),
      });
      if (optionValues.length > 0) {
        await transaction.insert(giftOrderOptionValues).values(
          optionValues.map(({ field, value }) => {
            const id = randomUUID();
            return {
              fieldKey: field.key,
              fieldLabel: field.label,
              giftOrderId: order.id,
              id,
              ...encryptedColumns(this.encryption.encrypt(value, `gift-order-option:${id}`)),
            };
          }),
        );
      }
      const [updated] = await transaction
        .update(giftOrders)
        .set({
          status: 'SUBMITTED',
          submittedAt: now,
          updatedAt: now,
          userId,
          version: order.version + 1,
        })
        .where(
          and(
            eq(giftOrders.id, order.id),
            eq(giftOrders.status, 'CLAIMABLE'),
            eq(giftOrders.version, order.version),
          ),
        )
        .returning({ id: giftOrders.id });
      if (!updated) {
        throw new AppError(
          'GIFT_ORDER_VERSION_CONFLICT',
          'This gift changed. Reload it before submitting.',
          409,
        );
      }
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: userId,
        fromStatus: 'CLAIMABLE',
        giftOrderId: order.id,
        toStatus: 'SUBMITTED',
      });
      await this.audit.record(
        {
          action: 'gift-order.submitted',
          actorUserId: context.actorUserId,
          afterSummary: {
            addressId: input.addressId,
            optionCount: optionValues.length,
          },
          creatorId: order.creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: order.id,
          targetType: 'gift-order',
        },
        transaction,
      );
    });
    return this.getForUser(userId, orderId);
  }

  public async listForCreator(creatorId: string, status?: GiftOrderStatus) {
    await this.expireClaimable();
    return this.serializeRows(
      await this.loadRows(
        and(
          eq(giftOrders.creatorId, creatorId),
          status ? eq(giftOrders.status, status) : undefined,
        ),
      ),
    );
  }

  private decrypt<T>(
    row: {
      readonly authenticationTag: string;
      readonly ciphertext: string;
      readonly id: string;
      readonly initializationVector: string;
      readonly keyVersion: number;
    },
    purpose: string,
  ): T {
    try {
      return this.encryption.decrypt<T>(row, `${purpose}:${row.id}`);
    } catch (error) {
      if (error instanceof EncryptionError) {
        throw new AppError(
          'GIFT_ORDER_DECRYPTION_FAILED',
          'Encrypted fulfillment data could not be read.',
          500,
        );
      }
      throw error;
    }
  }

  public async getForCreator(creatorId: string, orderId: string, context: RequestAuditContext) {
    const rows = await this.loadRows(
      and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId)),
    );
    const [order] = await this.serializeRows(rows);
    if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
    const [address] = await this.database.orm
      .select()
      .from(giftOrderAddresses)
      .where(eq(giftOrderAddresses.giftOrderId, order.id))
      .limit(1);
    const optionRows = await this.database.orm
      .select()
      .from(giftOrderOptionValues)
      .where(eq(giftOrderOptionValues.giftOrderId, order.id))
      .orderBy(asc(giftOrderOptionValues.createdAt));
    if (address || optionRows.length > 0) {
      await this.audit.record({
        action: 'gift-order.fulfillment-data-read',
        actorUserId: context.actorUserId,
        afterSummary: { address: Boolean(address), optionCount: optionRows.length },
        creatorId,
        ipAddress: context.ipAddress,
        requestId: context.requestId,
        targetId: order.id,
        targetType: 'gift-order',
      });
    }
    return {
      ...order,
      deliveryAddress: address ? this.decrypt<AddressPayload>(address, 'gift-order-address') : null,
      optionValues: optionRows.map((value) => ({
        key: value.fieldKey,
        label: value.fieldLabel,
        value: this.decrypt<ClaimValue>(value, 'gift-order-option'),
      })),
    };
  }

  private async transition(
    creatorId: string,
    orderId: string,
    from: readonly GiftOrderStatus[],
    to: GiftOrderStatus,
    context: RequestAuditContext,
    reason?: string,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [order] = await transaction
        .select()
        .from(giftOrders)
        .where(and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId)))
        .limit(1)
        .for('update');
      if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
      if (order.status === to) return order;
      if (!from.includes(order.status as GiftOrderStatus)) {
        throw new AppError(
          'GIFT_ORDER_TRANSITION_INVALID',
          `A ${order.status} order cannot move to ${to}.`,
          409,
        );
      }
      const now = new Date();
      const [updated] = await transaction
        .update(giftOrders)
        .set({
          ...(to === 'PROCESSING' ? { processingAt: now } : {}),
          ...(to === 'COMPLETED' ? { completedAt: now } : {}),
          ...(to === 'CANCELLED' ? { cancelReason: reason, cancelledAt: now } : {}),
          status: to,
          updatedAt: now,
          version: order.version + 1,
        })
        .where(eq(giftOrders.id, order.id))
        .returning();
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: context.actorUserId,
        fromStatus: order.status,
        giftOrderId: order.id,
        reason,
        toStatus: to,
      });
      await this.audit.record(
        {
          action: `gift-order.${to.toLowerCase()}`,
          actorUserId: context.actorUserId,
          afterSummary: { from: order.status, to },
          creatorId,
          ipAddress: context.ipAddress,
          reason,
          requestId: context.requestId,
          targetId: order.id,
          targetType: 'gift-order',
        },
        transaction,
      );
      return updated!;
    });
  }

  public markProcessing(creatorId: string, orderId: string, context: RequestAuditContext) {
    return this.transition(creatorId, orderId, ['SUBMITTED'], 'PROCESSING', context);
  }

  public complete(creatorId: string, orderId: string, context: RequestAuditContext) {
    return this.transition(creatorId, orderId, ['SHIPPED'], 'COMPLETED', context);
  }

  public cancel(creatorId: string, orderId: string, reason: string, context: RequestAuditContext) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      throw new AppError('GIFT_ORDER_CANCEL_REASON_INVALID', 'A cancel reason is required.', 400);
    }
    return this.transition(
      creatorId,
      orderId,
      ['SUBMITTED', 'PROCESSING'],
      'CANCELLED',
      context,
      normalizedReason,
    );
  }

  public async ship(
    creatorId: string,
    orderId: string,
    input: {
      readonly carrierCode: string;
      readonly carrierName: string;
      readonly trackingNumber: string;
      readonly trackingUrl?: string | null;
    },
    context: RequestAuditContext,
  ) {
    const carrierCode = cleanText(input.carrierCode, 80, 'Carrier code');
    const carrierName = cleanText(input.carrierName, 120, 'Carrier name');
    const trackingNumber = cleanText(input.trackingNumber, 160, 'Tracking number');
    let trackingUrl = input.trackingUrl?.trim() || null;
    if (trackingUrl && !URL.canParse(trackingUrl)) {
      throw new AppError('SHIPMENT_INVALID', 'Tracking URL is invalid.', 400);
    }
    trackingUrl ??= this.trackingProvider?.buildPublicUrl?.(carrierCode, trackingNumber) ?? null;

    await this.database.orm.transaction(async (transaction) => {
      const [order] = await transaction
        .select()
        .from(giftOrders)
        .where(and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId)))
        .limit(1)
        .for('update');
      if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
      if (order.status !== 'SUBMITTED' && order.status !== 'PROCESSING') {
        throw new AppError(
          'GIFT_ORDER_NOT_SHIPPABLE',
          'Only submitted or processing orders can be shipped.',
          409,
        );
      }
      const items = await transaction
        .select({ id: giftOrderItems.id })
        .from(giftOrderItems)
        .leftJoin(shipmentItems, eq(shipmentItems.giftOrderItemId, giftOrderItems.id))
        .where(
          and(eq(giftOrderItems.giftOrderId, order.id), isNull(shipmentItems.giftOrderItemId)),
        );
      if (items.length === 0) {
        throw new AppError(
          'GIFT_ORDER_ALREADY_SHIPPED',
          'All gift items are already shipped.',
          409,
        );
      }
      const now = new Date();
      if (order.status === 'SUBMITTED') {
        await transaction.insert(giftOrderStatusHistory).values({
          actorUserId: context.actorUserId,
          fromStatus: 'SUBMITTED',
          giftOrderId: order.id,
          toStatus: 'PROCESSING',
        });
      }
      const shipmentId = randomUUID();
      const [shipment] = await transaction
        .insert(shipments)
        .values({
          carrierCode,
          carrierName,
          creatorId,
          giftOrderId: order.id,
          id: shipmentId,
          nextTrackingRefreshAt: this.trackingProvider ? new Date(now.getTime() + 60_000) : null,
          shipmentKey: randomUUID(),
          shipmentNumber: `S-${randomUUID().slice(0, 10).toUpperCase()}`,
          trackingNumber,
          trackingUrl,
        })
        .returning();
      if (!shipment) throw new Error('Shipment insert returned no row.');
      await transaction.insert(shipmentItems).values(
        items.map((item) => ({
          giftOrderItemId: item.id,
          shipmentId: shipment.id,
        })),
      );
      await transaction
        .update(giftOrders)
        .set({
          processingAt: order.processingAt ?? now,
          shippedAt: now,
          status: 'SHIPPED',
          updatedAt: now,
          version: order.version + 1,
        })
        .where(eq(giftOrders.id, order.id));
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: context.actorUserId,
        fromStatus: 'PROCESSING',
        giftOrderId: order.id,
        toStatus: 'SHIPPED',
      });
      await this.audit.record(
        {
          action: 'gift-order.shipped',
          actorUserId: context.actorUserId,
          afterSummary: {
            carrierCode,
            itemCount: items.length,
            shipmentNumber: shipment.shipmentNumber,
          },
          creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: order.id,
          targetType: 'gift-order',
        },
        transaction,
      );
    });
    return this.getForCreator(creatorId, orderId, context);
  }

  public async refreshDue(): Promise<number> {
    if (!this.trackingProvider) return 0;
    const due = await this.database.orm
      .select()
      .from(shipments)
      .where(
        and(
          lte(shipments.nextTrackingRefreshAt, new Date()),
          inArray(shipments.status, [
            'LABEL_CREATED',
            'IN_TRANSIT',
            'OUT_FOR_DELIVERY',
            'EXCEPTION',
          ]),
        ),
      )
      .orderBy(asc(shipments.nextTrackingRefreshAt))
      .limit(50);
    for (const shipment of due) {
      try {
        const result = await this.trackingProvider.query(
          shipment.carrierCode,
          shipment.trackingNumber,
        );
        await this.database.orm.transaction(async (transaction) => {
          if (result.events.length > 0) {
            await transaction
              .insert(trackingEvents)
              .values(
                result.events.map((event) => ({
                  description: event.description,
                  location: event.location,
                  occurredAt: event.occurredAt,
                  providerEventId: event.id,
                  shipmentId: shipment.id,
                  status: event.status,
                })),
              )
              .onConflictDoNothing();
          }
          const now = new Date();
          await transaction
            .update(shipments)
            .set({
              deliveredAt: result.status === 'DELIVERED' ? now : shipment.deliveredAt,
              exceptionMessage:
                result.status === 'EXCEPTION'
                  ? (result.events.at(-1)?.description ?? 'Tracking exception')
                  : null,
              lastTrackingRefreshAt: now,
              nextTrackingRefreshAt: result.nextRefreshAt,
              status: result.status,
              trackingUrl: result.publicUrl ?? shipment.trackingUrl,
              updatedAt: now,
            })
            .where(eq(shipments.id, shipment.id));
          if (result.status === 'DELIVERED') {
            const [order] = await transaction
              .select({ status: giftOrders.status, version: giftOrders.version })
              .from(giftOrders)
              .where(eq(giftOrders.id, shipment.giftOrderId))
              .limit(1)
              .for('update');
            if (order?.status === 'SHIPPED') {
              await transaction
                .update(giftOrders)
                .set({
                  completedAt: now,
                  status: 'COMPLETED',
                  updatedAt: now,
                  version: order.version + 1,
                })
                .where(eq(giftOrders.id, shipment.giftOrderId));
              await transaction.insert(giftOrderStatusHistory).values({
                fromStatus: 'SHIPPED',
                giftOrderId: shipment.giftOrderId,
                reason: 'Tracking provider reported delivery.',
                toStatus: 'COMPLETED',
              });
            }
          }
        });
      } catch {
        await this.database.orm
          .update(shipments)
          .set({
            lastTrackingRefreshAt: new Date(),
            nextTrackingRefreshAt: new Date(Date.now() + 30 * 60_000),
          })
          .where(eq(shipments.id, shipment.id));
      }
    }
    return due.length;
  }
}
