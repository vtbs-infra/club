import { createHash } from 'node:crypto';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrderAddresses,
  giftOrderItems,
  giftOrderOptionValues,
  giftOrders,
  giftReleases,
} from '../../infrastructure/db/schema/index.js';
import {
  EncryptionError,
  type EncryptionKeyRing,
} from '../../infrastructure/encryption/key-ring.js';
import { isAddressPayload, type AddressPayload } from '../addresses/address-domain.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import { buildFulfillmentWorkbook, type FulfillmentWorkbookRow } from './fulfillment-workbook.js';

interface CreatorExportProfile {
  readonly displayName: string;
  readonly id: string;
  readonly timezone: string;
}

type ClaimValue = boolean | string;

export class GiftFulfillmentExportService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
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
    validate: (value: unknown) => value is T,
  ): T {
    try {
      const value = this.encryption.decrypt<unknown>(row, `${purpose}:${row.id}`);
      if (!validate(value)) throw new EncryptionError();
      return value;
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

  public async exportRelease(
    creator: CreatorExportProfile,
    releaseId: string,
    context: RequestAuditContext,
  ) {
    const source = await this.database.orm.transaction(
      async (transaction) => {
        const [release] = await transaction
          .select({
            eligibilityMonth: giftReleases.eligibilityMonth,
            formSchema: giftReleases.formSchema,
            id: giftReleases.id,
            title: giftReleases.title,
          })
          .from(giftReleases)
          .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creator.id)))
          .limit(1);
        if (!release) {
          throw new AppError('GIFT_RELEASE_NOT_FOUND', 'Gift release not found.', 404);
        }

        const orders = await transaction
          .select({
            address: giftOrderAddresses,
            biliDisplayName: giftOrders.biliDisplayName,
            biliUid: giftOrders.biliUid,
            id: giftOrders.id,
            orderNumber: giftOrders.orderNumber,
            submittedAt: giftOrders.submittedAt,
            tier: giftOrders.tier,
          })
          .from(giftOrders)
          .leftJoin(giftOrderAddresses, eq(giftOrderAddresses.giftOrderId, giftOrders.id))
          .where(
            and(
              eq(giftOrders.creatorId, creator.id),
              eq(giftOrders.giftReleaseId, release.id),
              eq(giftOrders.status, 'SUBMITTED'),
            ),
          )
          .orderBy(asc(giftOrders.orderNumber));
        if (orders.length === 0) {
          throw new AppError(
            'FULFILLMENT_EXPORT_EMPTY',
            'This gift release has no orders waiting to ship.',
            409,
          );
        }

        const orderIds = orders.map((order) => order.id);
        const items = await transaction
          .select({
            giftOrderId: giftOrderItems.giftOrderId,
            packageSnapshot: giftOrderItems.packageSnapshot,
            sortOrder: giftOrderItems.sortOrder,
          })
          .from(giftOrderItems)
          .where(inArray(giftOrderItems.giftOrderId, orderIds))
          .orderBy(asc(giftOrderItems.sortOrder));
        const options = await transaction
          .select()
          .from(giftOrderOptionValues)
          .where(inArray(giftOrderOptionValues.giftOrderId, orderIds))
          .orderBy(asc(giftOrderOptionValues.createdAt));
        return { items, options, orders, release };
      },
      { accessMode: 'read only', isolationLevel: 'repeatable read' },
    );

    const itemsByOrder = new Map<string, (typeof source.items)[number]['packageSnapshot'][]>();
    for (const item of source.items) {
      const orderItems = itemsByOrder.get(item.giftOrderId) ?? [];
      orderItems.push(item.packageSnapshot);
      itemsByOrder.set(item.giftOrderId, orderItems);
    }
    const optionsByOrder = new Map<string, Record<string, ClaimValue>>();
    for (const option of source.options) {
      const orderOptions = optionsByOrder.get(option.giftOrderId) ?? {};
      orderOptions[option.fieldKey] = this.decrypt<ClaimValue>(
        option,
        'gift-order-option',
        (value): value is ClaimValue => typeof value === 'boolean' || typeof value === 'string',
      );
      optionsByOrder.set(option.giftOrderId, orderOptions);
    }
    const rows: FulfillmentWorkbookRow[] = source.orders.map((order) => {
      if (
        !order.address ||
        !order.submittedAt ||
        (order.tier !== 'CAPTAIN' && order.tier !== 'ADMIRAL' && order.tier !== 'GOVERNOR')
      ) {
        throw new AppError(
          'FULFILLMENT_EXPORT_DATA_INVALID',
          'A gift order contains invalid fulfillment data.',
          500,
        );
      }
      const packages = itemsByOrder.get(order.id) ?? [];
      if (packages.length === 0) {
        throw new AppError(
          'FULFILLMENT_EXPORT_DATA_INVALID',
          'A gift order contains invalid fulfillment data.',
          500,
        );
      }
      return {
        address: this.decrypt<AddressPayload>(
          order.address,
          'gift-order-address',
          isAddressPayload,
        ),
        biliDisplayName: order.biliDisplayName,
        biliUid: order.biliUid,
        optionValues: optionsByOrder.get(order.id) ?? {},
        orderNumber: order.orderNumber,
        packages,
        submittedAt: order.submittedAt,
        tier: order.tier,
      };
    });
    const generatedAt = this.clock.now();
    const content = await buildFulfillmentWorkbook({
      creatorDisplayName: creator.displayName,
      eligibilityMonth: source.release.eligibilityMonth,
      fields: source.release.formSchema.map((field) => ({
        key: field.key,
        label: field.label,
      })),
      generatedAt,
      releaseTitle: source.release.title,
      rows,
      timezone: creator.timezone,
    });
    const fileSha256 = createHash('sha256').update(content).digest('hex');
    await this.audit.record({
      action: 'gift-release.fulfillment-exported',
      actorUserId: context.actorUserId,
      afterSummary: {
        fileSha256,
        format: 'xlsx',
        generatedAt: generatedAt.toISOString(),
        includedStatuses: ['SUBMITTED'],
        rowCount: rows.length,
      },
      creatorId: creator.id,
      ipAddress: context.ipAddress,
      requestId: context.requestId,
      targetId: source.release.id,
      targetType: 'gift-release',
    });
    return {
      content,
      creatorDisplayName: creator.displayName,
      eligibilityMonth: source.release.eligibilityMonth,
      generatedAt,
      releaseTitle: source.release.title,
      rowCount: rows.length,
    };
  }
}
