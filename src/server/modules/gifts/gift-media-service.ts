import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import sharp from 'sharp';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  creators,
  giftCoverObjects,
  giftOrders,
  giftReleases,
} from '../../infrastructure/db/schema/index.js';
import type { AccountRole } from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedFormats = new Set(['jpeg', 'png', 'webp']);
const maximumUploadBytes = 5 * 1024 * 1024;
export const GIFT_COVER_STAGED_SAFETY_MS = 60 * 60_000;
export const GIFT_COVER_CLEANUP_BATCH_SIZE = 100;
type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;

async function normalizeCover(bytes: Uint8Array, mimeType: string): Promise<Buffer> {
  if (!allowedMimeTypes.has(mimeType) || bytes.byteLength > maximumUploadBytes) {
    throw new AppError(
      'GIFT_COVER_INVALID',
      'Upload a JPEG, PNG, or WebP image no larger than 5 MB.',
      400,
    );
  }
  let metadata: SharpMetadata;
  try {
    metadata = await sharp(bytes, {
      animated: false,
      limitInputPixels: 40_000_000,
    }).metadata();
  } catch {
    throw new AppError('GIFT_COVER_INVALID', 'The uploaded file is not a valid image.', 400);
  }
  if (
    !metadata.format ||
    !allowedFormats.has(metadata.format) ||
    !metadata.width ||
    !metadata.height
  ) {
    throw new AppError('GIFT_COVER_INVALID', 'The uploaded file is not supported.', 400);
  }
  return sharp(bytes, {
    animated: false,
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .resize({ fit: 'inside', height: 1_600, width: 1_600, withoutEnlargement: true })
    .webp({ effort: 4, quality: 88 })
    .toBuffer();
}

export class GiftMediaService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageDriver,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async requireEditableRelease(
    creatorId: string,
    releaseId: string,
    transaction: AppDatabase,
  ) {
    const [release] = await transaction
      .select({ id: giftReleases.id, status: giftReleases.status })
      .from(giftReleases)
      .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
      .limit(1)
      .for('update');
    if (!release) throw new AppError('GIFT_RELEASE_NOT_FOUND', 'Gift release not found.', 404);
    if (release.status !== 'DRAFT') {
      throw new AppError(
        'GIFT_RELEASE_IMMUTABLE',
        'A published gift release can no longer be edited.',
        409,
      );
    }
    return release;
  }

  public async uploadCover(
    creatorId: string,
    releaseId: string,
    input: RequestAuditContext & {
      readonly bytes: Uint8Array;
      readonly mimeType: string;
    },
  ) {
    const normalized = await normalizeCover(input.bytes, input.mimeType);
    const objectKey = `public/gifts/${releaseId}/${randomUUID()}.webp`;
    const stagedAt = this.clock.now();
    await this.database.orm.transaction(async (transaction) => {
      await this.requireEditableRelease(creatorId, releaseId, transaction);
      await transaction.insert(giftCoverObjects).values({
        byteLength: normalized.byteLength,
        createdAt: stagedAt,
        objectKey,
        state: 'STAGED',
        updatedAt: stagedAt,
      });
    });

    await this.storage.put({ data: normalized, key: objectKey });

    await this.database.orm.transaction(async (transaction) => {
      const release = await this.requireEditableRelease(creatorId, releaseId, transaction);
      const [staged] = await transaction
        .select({ objectKey: giftCoverObjects.objectKey, state: giftCoverObjects.state })
        .from(giftCoverObjects)
        .where(eq(giftCoverObjects.objectKey, objectKey))
        .limit(1)
        .for('update');
      if (!staged || staged.state !== 'STAGED') {
        throw new AppError(
          'GIFT_COVER_STAGE_EXPIRED',
          'The staged cover is no longer available. Upload it again.',
          409,
        );
      }
      const now = this.clock.now();
      await transaction
        .update(giftCoverObjects)
        .set({ giftReleaseId: null, state: 'DELETE_PENDING', updatedAt: now })
        .where(
          and(eq(giftCoverObjects.giftReleaseId, release.id), eq(giftCoverObjects.state, 'ACTIVE')),
        );
      const [activated] = await transaction
        .update(giftCoverObjects)
        .set({ giftReleaseId: release.id, state: 'ACTIVE', updatedAt: now })
        .where(
          and(
            eq(giftCoverObjects.objectKey, objectKey),
            eq(giftCoverObjects.state, 'STAGED'),
            isNull(giftCoverObjects.giftReleaseId),
          ),
        )
        .returning({ objectKey: giftCoverObjects.objectKey });
      if (!activated) throw new Error('Locked staged gift cover could not be activated.');
      await transaction
        .update(giftReleases)
        .set({ updatedAt: now })
        .where(eq(giftReleases.id, release.id));
      await this.audit.record(
        {
          action: 'gift-release.cover-updated',
          actorUserId: input.actorUserId,
          afterSummary: { byteLength: normalized.byteLength },
          creatorId,
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: release.id,
          targetType: 'gift-release',
        },
        transaction,
      );
    });
    return { coverImageUrl: `/api/v1/gift-releases/${releaseId}/cover` };
  }

  public async removeCover(
    creatorId: string,
    releaseId: string,
    context: RequestAuditContext,
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const release = await this.requireEditableRelease(creatorId, releaseId, transaction);
      const now = this.clock.now();
      const retired = await transaction
        .update(giftCoverObjects)
        .set({ giftReleaseId: null, state: 'DELETE_PENDING', updatedAt: now })
        .where(
          and(eq(giftCoverObjects.giftReleaseId, release.id), eq(giftCoverObjects.state, 'ACTIVE')),
        )
        .returning({ objectKey: giftCoverObjects.objectKey });
      await transaction
        .update(giftReleases)
        .set({ updatedAt: now })
        .where(eq(giftReleases.id, release.id));
      await this.audit.record(
        {
          action: 'gift-release.cover-removed',
          actorUserId: context.actorUserId,
          afterSummary: { removed: retired.length > 0 },
          creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: release.id,
          targetType: 'gift-release',
        },
        transaction,
      );
    });
  }

  public async cleanupObjects(
    stagedBefore: Date,
    limit = GIFT_COVER_CLEANUP_BATCH_SIZE,
  ): Promise<number> {
    const candidates = await this.database.orm
      .select({ objectKey: giftCoverObjects.objectKey })
      .from(giftCoverObjects)
      .where(
        or(
          eq(giftCoverObjects.state, 'DELETE_PENDING'),
          and(eq(giftCoverObjects.state, 'STAGED'), lte(giftCoverObjects.updatedAt, stagedBefore)),
        ),
      )
      .orderBy(asc(giftCoverObjects.updatedAt), asc(giftCoverObjects.objectKey))
      .limit(limit);
    let removed = 0;
    const failures: unknown[] = [];
    for (const candidate of candidates) {
      const claimed = await this.database.orm.transaction(async (transaction) => {
        const [object] = await transaction
          .select()
          .from(giftCoverObjects)
          .where(eq(giftCoverObjects.objectKey, candidate.objectKey))
          .limit(1)
          .for('update');
        if (!object || object.giftReleaseId !== null) return null;
        const staleStaged = object.state === 'STAGED' && object.updatedAt <= stagedBefore;
        if (object.state !== 'DELETE_PENDING' && !staleStaged) return null;
        if (object.state === 'STAGED') {
          await transaction
            .update(giftCoverObjects)
            .set({ state: 'DELETE_PENDING', updatedAt: this.clock.now() })
            .where(eq(giftCoverObjects.objectKey, object.objectKey));
        }
        return object.objectKey;
      });
      if (!claimed) continue;
      try {
        await this.storage.delete(claimed);
        const deleted = await this.database.orm
          .delete(giftCoverObjects)
          .where(
            and(
              eq(giftCoverObjects.objectKey, claimed),
              eq(giftCoverObjects.state, 'DELETE_PENDING'),
              isNull(giftCoverObjects.giftReleaseId),
            ),
          )
          .returning({ objectKey: giftCoverObjects.objectKey });
        removed += deleted.length;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more gift cover objects could not be cleaned.');
    }
    return removed;
  }

  public async openCover(
    releaseId: string,
    viewer: { readonly role: AccountRole; readonly userId: string } | null,
  ) {
    const [release] = await this.database.orm
      .select({
        claimDeadlineAt: giftReleases.claimDeadlineAt,
        claimStartAt: giftReleases.claimStartAt,
        creatorUserId: creators.userId,
        objectKey: giftCoverObjects.objectKey,
        publicVisible: giftReleases.publicVisible,
        status: giftReleases.status,
      })
      .from(giftCoverObjects)
      .innerJoin(giftReleases, eq(giftReleases.id, giftCoverObjects.giftReleaseId))
      .innerJoin(creators, eq(creators.id, giftReleases.creatorId))
      .where(and(eq(giftReleases.id, releaseId), eq(giftCoverObjects.state, 'ACTIVE')))
      .limit(1);
    if (!release) throw new AppError('GIFT_COVER_NOT_FOUND', 'Gift cover not found.', 404);
    const now = this.clock.now();
    const publiclyAccessible =
      release.publicVisible &&
      release.status === 'PUBLISHED' &&
      release.claimStartAt <= now &&
      release.claimDeadlineAt > now;
    let authorized = publiclyAccessible || viewer?.role === 'PLATFORM_ADMIN';
    if (!authorized && viewer && release.creatorUserId === viewer.userId) authorized = true;
    if (!authorized && viewer) {
      const [binding] = await this.database.orm
        .select({ biliUid: bilibiliBindings.biliUid })
        .from(bilibiliBindings)
        .where(and(eq(bilibiliBindings.userId, viewer.userId), isNull(bilibiliBindings.unboundAt)))
        .limit(1);
      const [order] = await this.database.orm
        .select({ id: giftOrders.id })
        .from(giftOrders)
        .where(
          and(
            eq(giftOrders.giftReleaseId, releaseId),
            binding
              ? or(eq(giftOrders.userId, viewer.userId), eq(giftOrders.biliUid, binding.biliUid))
              : eq(giftOrders.userId, viewer.userId),
          ),
        )
        .limit(1);
      authorized = Boolean(order);
    }
    if (!authorized) throw new AppError('GIFT_COVER_NOT_FOUND', 'Gift cover not found.', 404);
    return this.storage.open(release.objectKey);
  }
}
