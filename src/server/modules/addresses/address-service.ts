import { randomUUID } from 'node:crypto';

import { and, count, desc, eq, ne } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import { addresses, users } from '../../infrastructure/db/schema/index.js';
import { EncryptionError, type EncryptedValue } from '../../infrastructure/encryption/key-ring.js';
import type { EncryptionKeyRing } from '../../infrastructure/encryption/key-ring.js';
import { AuditService } from '../audit/audit-service.js';
import type { RequestAuditContext } from '../audit/audit-service.js';
import {
  isAddressPayload,
  normalizeAddressPayload,
  type AddressPayload,
} from './address-domain.js';

export interface AddressInput {
  readonly isDefault: boolean;
  readonly label: string;
  readonly payload: AddressPayload;
}

export const ADDRESS_LIMIT_PER_USER = 20;

function encryptedColumns(value: EncryptedValue) {
  return {
    authenticationTag: value.authenticationTag,
    ciphertext: value.ciphertext,
    initializationVector: value.initializationVector,
    keyVersion: value.keyVersion,
  };
}

export class AddressService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
  ) {
    this.audit = new AuditService(database);
  }

  private decrypt(row: typeof addresses.$inferSelect): AddressPayload {
    try {
      const payload = this.encryption.decrypt<AddressPayload>(
        {
          authenticationTag: row.authenticationTag,
          ciphertext: row.ciphertext,
          initializationVector: row.initializationVector,
          keyVersion: row.keyVersion,
        },
        `address:${row.id}`,
      );
      if (!isAddressPayload(payload)) throw new EncryptionError();
      return payload;
    } catch {
      throw new AppError(
        'ADDRESS_DECRYPTION_FAILED',
        'An encrypted address could not be read with the configured key ring.',
        500,
      );
    }
  }

  private response(row: typeof addresses.$inferSelect) {
    return {
      createdAt: row.createdAt,
      id: row.id,
      isDefault: row.isDefault,
      label: row.label,
      payload: this.decrypt(row),
      updatedAt: row.updatedAt,
    };
  }

  public async list(userId: string) {
    const rows = await this.database.orm
      .select()
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(desc(addresses.isDefault), desc(addresses.updatedAt));
    return rows.map((row) => this.response(row));
  }

  public async create(userId: string, input: AddressInput, context: RequestAuditContext) {
    const payload = normalizeAddressPayload(input.payload);
    if (!input.label.trim() || input.label.length > 80) {
      throw new AppError('ADDRESS_LABEL_INVALID', 'Address label is invalid.', 400);
    }
    return this.database.orm.transaction(async (transaction) => {
      const [owner] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for('update');
      if (!owner) throw new AppError('USER_NOT_FOUND', 'User account not found.', 404);
      const [total] = await transaction
        .select({ value: count() })
        .from(addresses)
        .where(eq(addresses.userId, userId));
      if (Number(total?.value ?? 0) >= ADDRESS_LIMIT_PER_USER) {
        throw new AppError(
          'ADDRESS_LIMIT_REACHED',
          `An account can store at most ${ADDRESS_LIMIT_PER_USER} addresses.`,
          409,
        );
      }
      const existing = await transaction
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.userId, userId))
        .limit(1);
      const isDefault = input.isDefault || existing.length === 0;
      if (isDefault) {
        await transaction
          .update(addresses)
          .set({ isDefault: false })
          .where(eq(addresses.userId, userId));
      }
      const id = randomUUID();
      const encrypted = this.encryption.encrypt(payload, `address:${id}`);
      const [row] = await transaction
        .insert(addresses)
        .values({
          id,
          isDefault,
          label: input.label.trim(),
          userId,
          ...encryptedColumns(encrypted),
        })
        .returning();
      await this.audit.record(
        {
          action: 'address.created',
          actorUserId: context.actorUserId,
          afterSummary: { isDefault, label: input.label.trim() },
          ipAddress: context.ipAddress ?? null,
          requestId: context.requestId ?? null,
          targetId: id,
          targetType: 'address',
        },
        transaction,
      );
      return this.response(row!);
    });
  }

  public async update(
    userId: string,
    addressId: string,
    input: Partial<AddressInput>,
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const row = await this.getOwned(userId, addressId, transaction, true);
      if (input.label !== undefined && (!input.label.trim() || input.label.length > 80)) {
        throw new AppError('ADDRESS_LABEL_INVALID', 'Address label is invalid.', 400);
      }
      if (input.isDefault) {
        await transaction
          .update(addresses)
          .set({ isDefault: false })
          .where(eq(addresses.userId, userId));
      }
      let isDefault = input.isDefault;
      let replacementId: string | null = null;
      if (row.isDefault && input.isDefault === false) {
        const [replacement] = await transaction
          .select({ id: addresses.id })
          .from(addresses)
          .where(and(eq(addresses.userId, userId), ne(addresses.id, addressId)))
          .orderBy(desc(addresses.updatedAt))
          .limit(1)
          .for('update');
        if (replacement) replacementId = replacement.id;
        else isDefault = true;
      }
      const encrypted =
        input.payload === undefined
          ? {}
          : encryptedColumns(
              this.encryption.encrypt(
                normalizeAddressPayload(input.payload),
                `address:${addressId}`,
              ),
            );
      const [updated] = await transaction
        .update(addresses)
        .set({
          ...encrypted,
          ...(isDefault === undefined ? {} : { isDefault }),
          ...(input.label === undefined ? {} : { label: input.label.trim() }),
          updatedAt: new Date(),
        })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
        .returning();
      if (replacementId) {
        await transaction
          .update(addresses)
          .set({ isDefault: true })
          .where(eq(addresses.id, replacementId));
      }
      await this.audit.record(
        {
          action: 'address.updated',
          actorUserId: context.actorUserId,
          afterSummary: {
            isDefault: updated!.isDefault,
            label: updated!.label,
            payloadChanged: input.payload !== undefined,
          },
          beforeSummary: { isDefault: row.isDefault, label: row.label },
          ipAddress: context.ipAddress ?? null,
          requestId: context.requestId ?? null,
          targetId: addressId,
          targetType: 'address',
        },
        transaction,
      );
      return this.response(updated!);
    });
  }

  public async delete(userId: string, addressId: string, context: RequestAuditContext) {
    await this.database.orm.transaction(async (transaction) => {
      const row = await this.getOwned(userId, addressId, transaction, true);
      await transaction
        .delete(addresses)
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));
      if (row.isDefault) {
        const [replacement] = await transaction
          .select({ id: addresses.id })
          .from(addresses)
          .where(eq(addresses.userId, userId))
          .orderBy(desc(addresses.updatedAt))
          .limit(1);
        if (replacement) {
          await transaction
            .update(addresses)
            .set({ isDefault: true })
            .where(eq(addresses.id, replacement.id));
        }
      }
      await this.audit.record(
        {
          action: 'address.deleted',
          actorUserId: context.actorUserId,
          beforeSummary: { isDefault: row.isDefault, label: row.label },
          ipAddress: context.ipAddress ?? null,
          requestId: context.requestId ?? null,
          targetId: addressId,
          targetType: 'address',
        },
        transaction,
      );
    });
  }

  public async getPlaintext(
    userId: string,
    addressId: string,
    executor: AppDatabase = this.database.orm,
  ) {
    const row = await this.getOwned(userId, addressId, executor, false);
    return { payload: this.decrypt(row), row };
  }

  private async getOwned(userId: string, addressId: string, executor: AppDatabase, lock: boolean) {
    const query = executor
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new AppError('ADDRESS_NOT_FOUND', 'Address not found.', 404);
    return row;
  }
}
