import { and, asc, eq, inArray } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrderAddresses,
  giftOrders,
  giftReleases,
} from '../../infrastructure/db/schema/index.js';
import {
  EncryptionError,
  type EncryptionKeyRing,
} from '../../infrastructure/encryption/key-ring.js';
import { isAddressPayload } from '../addresses/address-domain.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import { relevantMonthlyPeriods } from '../snapshots/month-end.js';
import {
  buildGuardAddressWorkbook,
  type GuardAddressWorkbookRow,
} from './guard-address-workbook.js';

interface CreatorExportProfile {
  readonly displayName: string;
  readonly id: string;
  readonly timezone: string;
}

export class GuardAddressExportService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private decryptAddress(row: typeof giftOrderAddresses.$inferSelect) {
    try {
      const value = this.encryption.decrypt<unknown>(row, `gift-order-address:${row.id}`);
      if (!isAddressPayload(value)) throw new EncryptionError();
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

  public async exportCurrentMonth(creator: CreatorExportProfile, context: RequestAuditContext) {
    const generatedAt = this.clock.now();
    const periodStart = relevantMonthlyPeriods(generatedAt, creator.timezone)[0];
    const result = await this.database.orm.transaction(async (transaction) => {
      const sourceRows = await transaction
        .select({
          address: giftOrderAddresses,
          biliUid: giftOrders.biliUid,
          displayName: giftOrders.biliDisplayName,
          orderId: giftOrders.id,
          orderNumber: giftOrders.orderNumber,
          orderStatus: giftOrders.status,
          tier: giftOrders.tier,
        })
        .from(giftOrders)
        .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
        .innerJoin(giftOrderAddresses, eq(giftOrderAddresses.giftOrderId, giftOrders.id))
        .where(
          and(
            eq(giftOrders.creatorId, creator.id),
            eq(giftReleases.eligibilityMonth, periodStart),
            inArray(giftOrders.status, ['SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED']),
          ),
        )
        .orderBy(asc(giftOrders.biliUid), asc(giftOrders.orderNumber));

      const workbookRows: GuardAddressWorkbookRow[] = sourceRows.map((row) => {
        if (row.tier !== 'CAPTAIN' && row.tier !== 'ADMIRAL' && row.tier !== 'GOVERNOR') {
          throw new AppError(
            'GIFT_ORDER_GUARD_TIER_INVALID',
            'A gift order contains an unsupported guard tier.',
            500,
          );
        }
        return {
          address: this.decryptAddress(row.address),
          biliUid: row.biliUid,
          displayName: row.displayName,
          orderNumber: row.orderNumber,
          orderStatus: row.orderStatus,
          tier: row.tier,
        };
      });
      const content = await buildGuardAddressWorkbook({
        creatorDisplayName: creator.displayName,
        generatedAt,
        periodStart,
        rows: workbookRows,
        timezone: creator.timezone,
      });

      for (const row of sourceRows) {
        await this.audit.record(
          {
            action: 'gift-order.address-exported',
            actorUserId: context.actorUserId,
            afterSummary: {
              format: 'xlsx',
              periodStart,
              source: 'current-month-guard-export',
            },
            creatorId: creator.id,
            ipAddress: context.ipAddress,
            requestId: context.requestId,
            targetId: row.orderId,
            targetType: 'gift-order',
          },
          transaction,
        );
      }
      await this.audit.record(
        {
          action: 'gift-order.guard-xlsx-exported',
          actorUserId: context.actorUserId,
          afterSummary: { periodStart, rowCount: workbookRows.length },
          creatorId: creator.id,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: creator.id,
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
}
