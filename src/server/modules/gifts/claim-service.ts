import { randomUUID } from 'node:crypto';

import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  giftOrderAddresses,
  giftOrderOptionValues,
  giftOrders,
  giftOrderStatusHistory,
  giftReleases,
} from '../../infrastructure/db/schema/index.js';
import type {
  EncryptedValue,
  EncryptionKeyRing,
} from '../../infrastructure/encryption/key-ring.js';
import type { AddressService } from '../addresses/address-service.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

type ClaimValue = boolean | string;

function encryptedColumns(value: EncryptedValue) {
  return {
    authenticationTag: value.authenticationTag,
    ciphertext: value.ciphertext,
    initializationVector: value.initializationVector,
    keyVersion: value.keyVersion,
  };
}

export class GiftClaimService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
    private readonly addresses: AddressService,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  public async expireClaimable(): Promise<number> {
    const now = this.clock.now();
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
  ): Promise<void> {
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
          status: giftReleases.status,
        })
        .from(giftReleases)
        .where(eq(giftReleases.id, order.giftReleaseId))
        .limit(1);
      const now = this.clock.now();
      if (
        !release ||
        release.status !== 'PUBLISHED' ||
        now < release.claimStartAt ||
        now >= release.claimDeadlineAt ||
        now >= order.expiresAt
      ) {
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
  }
}
