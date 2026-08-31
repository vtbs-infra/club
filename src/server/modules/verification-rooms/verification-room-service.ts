import { asc, count, eq, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { verificationRooms } from '../../infrastructure/db/schema/index.js';
import { AuditService } from '../audit/audit-service.js';
import type { RequestAuditContext } from '../audit/audit-service.js';
import type { RoomConnectionManager } from '../bilibili/room-connection-manager.js';

export interface CreateVerificationRoomInput extends RequestAuditContext {
  readonly biliRoomId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly priority: number;
}

export interface UpdateVerificationRoomInput extends RequestAuditContext {
  readonly displayName?: string;
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly roomId: string;
}

export const VERIFICATION_ROOM_LIMIT = 20;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export class VerificationRoomService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly connections: RoomConnectionManager,
    private readonly onConfigurationChange?: () => void,
    private readonly reportError?: (error: unknown, operation: string) => void,
  ) {
    this.audit = new AuditService(database);
  }

  private notifyConfigurationChange(): void {
    try {
      this.onConfigurationChange?.();
    } catch (error) {
      this.reportError?.(error, 'verification-room.reconcile');
      // Periodic reconciliation will retry if the database or source is unavailable here.
    }
  }

  public list() {
    return this.database.orm
      .select()
      .from(verificationRooms)
      .orderBy(asc(verificationRooms.priority), asc(verificationRooms.displayName));
  }

  public async create(input: CreateVerificationRoomInput) {
    try {
      const created = await this.database.orm.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext('club:verification-rooms'))`,
        );
        const [total] = await transaction.select({ value: count() }).from(verificationRooms);
        if (Number(total?.value ?? 0) >= VERIFICATION_ROOM_LIMIT) {
          throw new AppError(
            'VERIFICATION_ROOM_LIMIT_REACHED',
            `The platform can configure at most ${VERIFICATION_ROOM_LIMIT} verification rooms.`,
            409,
          );
        }
        const [room] = await transaction
          .insert(verificationRooms)
          .values({
            biliRoomId: input.biliRoomId,
            displayName: input.displayName,
            enabled: input.enabled,
            priority: input.priority,
          })
          .returning();
        if (!room) throw new Error('Verification-room insert returned no row.');
        await this.audit.record(
          {
            action: 'verification-room.created',
            actorUserId: input.actorUserId,
            afterSummary: {
              biliRoomId: room.biliRoomId,
              displayName: room.displayName,
              enabled: room.enabled,
              priority: room.priority,
            },
            ipAddress: input.ipAddress,
            requestId: input.requestId,
            targetId: room.id,
            targetType: 'verification-room',
          },
          transaction,
        );
        return room;
      });
      this.notifyConfigurationChange();
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'VERIFICATION_ROOM_CONFLICT',
          'This Bilibili room is already configured.',
          409,
        );
      }
      throw error;
    }
  }

  public async update(input: UpdateVerificationRoomInput) {
    const updated = await this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(verificationRooms)
        .where(eq(verificationRooms.id, input.roomId))
        .limit(1);
      if (!before) {
        throw new AppError('VERIFICATION_ROOM_NOT_FOUND', 'Verification room not found.', 404);
      }
      const [room] = await transaction
        .update(verificationRooms)
        .set({
          displayName: input.displayName ?? before.displayName,
          enabled: input.enabled ?? before.enabled,
          priority: input.priority ?? before.priority,
          updatedAt: new Date(),
        })
        .where(eq(verificationRooms.id, input.roomId))
        .returning();
      if (!room) throw new Error('Verification-room update returned no row.');
      await this.audit.record(
        {
          action: 'verification-room.updated',
          actorUserId: input.actorUserId,
          afterSummary: {
            displayName: room.displayName,
            enabled: room.enabled,
            priority: room.priority,
          },
          beforeSummary: {
            displayName: before.displayName,
            enabled: before.enabled,
            priority: before.priority,
          },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: room.id,
          targetType: 'verification-room',
        },
        transaction,
      );
      return room;
    });
    this.notifyConfigurationChange();
    return updated;
  }

  public async test(input: RequestAuditContext & { readonly roomId: string }) {
    const [room] = await this.database.orm
      .select()
      .from(verificationRooms)
      .where(eq(verificationRooms.id, input.roomId))
      .limit(1);
    if (!room) {
      throw new AppError('VERIFICATION_ROOM_NOT_FOUND', 'Verification room not found.', 404);
    }
    try {
      await this.connections.testRoom(room.biliRoomId);
    } catch {
      const now = new Date();
      await this.database.orm.transaction(async (transaction) => {
        await transaction
          .update(verificationRooms)
          .set({ healthStatus: 'UNHEALTHY', updatedAt: now })
          .where(eq(verificationRooms.id, room.id));
        await this.audit.record(
          {
            action: 'verification-room.connectivity-failed',
            actorUserId: input.actorUserId,
            afterSummary: { healthStatus: 'UNHEALTHY' },
            ipAddress: input.ipAddress,
            requestId: input.requestId,
            targetId: room.id,
            targetType: 'verification-room',
          },
          transaction,
        );
      });
      throw new AppError(
        'VERIFICATION_ROOM_CONNECTION_FAILED',
        'The verification room connection test failed.',
        502,
      );
    }
    const now = new Date();
    return this.database.orm.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(verificationRooms)
        .set({ healthStatus: 'HEALTHY', lastConnectedAt: now, updatedAt: now })
        .where(eq(verificationRooms.id, room.id))
        .returning();
      if (!updated) throw new Error('Verification-room test update returned no row.');
      await this.audit.record(
        {
          action: 'verification-room.connectivity-tested',
          actorUserId: input.actorUserId,
          afterSummary: { healthStatus: 'HEALTHY' },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: room.id,
          targetType: 'verification-room',
        },
        transaction,
      );
      return updated;
    });
  }
}
