import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { giftReleases } from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedFormats = new Set(['jpeg', 'png', 'webp']);
const maximumUploadBytes = 5 * 1024 * 1024;

export class GiftMediaService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageDriver,
  ) {
    this.audit = new AuditService(database);
  }

  public async uploadCover(
    creatorId: string,
    releaseId: string,
    input: RequestAuditContext & {
      readonly bytes: Uint8Array;
      readonly mimeType: string;
    },
  ) {
    if (!allowedMimeTypes.has(input.mimeType) || input.bytes.byteLength > maximumUploadBytes) {
      throw new AppError(
        'GIFT_COVER_INVALID',
        'Upload a JPEG, PNG, or WebP image no larger than 5 MB.',
        400,
      );
    }
    let metadata: Awaited<ReturnType<sharp.Sharp['metadata']>>;
    try {
      metadata = await sharp(input.bytes, {
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
    const normalized = await sharp(input.bytes, {
      animated: false,
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({ fit: 'inside', height: 1_600, width: 1_600, withoutEnlargement: true })
      .webp({ effort: 4, quality: 88 })
      .toBuffer();
    const objectKey = `public/gifts/${releaseId}/${randomUUID()}.webp`;
    await this.storage.put({ data: normalized, key: objectKey });
    try {
      const result = await this.database.orm.transaction(async (transaction) => {
        const [release] = await transaction
          .select()
          .from(giftReleases)
          .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
          .limit(1)
          .for('update');
        if (!release) {
          throw new AppError('GIFT_RELEASE_NOT_FOUND', 'Gift release not found.', 404);
        }
        if (release.status !== 'DRAFT') {
          throw new AppError(
            'GIFT_RELEASE_IMMUTABLE',
            'A published gift release can no longer be edited.',
            409,
          );
        }
        await transaction
          .update(giftReleases)
          .set({ coverObjectKey: objectKey, updatedAt: new Date() })
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
        return { oldObjectKey: release.coverObjectKey };
      });
      if (result.oldObjectKey)
        await this.storage.delete(result.oldObjectKey).catch(() => undefined);
      return { coverImageUrl: `/api/v1/gift-releases/${releaseId}/cover` };
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  public async removeCover(
    creatorId: string,
    releaseId: string,
    context: RequestAuditContext,
  ): Promise<void> {
    const oldObjectKey = await this.database.orm.transaction(async (transaction) => {
      const [release] = await transaction
        .select()
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
      await transaction
        .update(giftReleases)
        .set({ coverObjectKey: null, updatedAt: new Date() })
        .where(eq(giftReleases.id, release.id));
      await this.audit.record(
        {
          action: 'gift-release.cover-removed',
          actorUserId: context.actorUserId,
          creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: release.id,
          targetType: 'gift-release',
        },
        transaction,
      );
      return release.coverObjectKey;
    });
    if (oldObjectKey) await this.storage.delete(oldObjectKey).catch(() => undefined);
  }

  public async openCover(releaseId: string) {
    const [release] = await this.database.orm
      .select({ objectKey: giftReleases.coverObjectKey })
      .from(giftReleases)
      .where(eq(giftReleases.id, releaseId))
      .limit(1);
    if (!release?.objectKey)
      throw new AppError('GIFT_COVER_NOT_FOUND', 'Gift cover not found.', 404);
    return this.storage.open(release.objectKey);
  }
}
