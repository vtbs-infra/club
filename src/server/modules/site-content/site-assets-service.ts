import { createHash, randomUUID } from 'node:crypto';

import { eq, or } from 'drizzle-orm';
import sharp from 'sharp';

import { AppError } from '../../../shared/errors/app-error.js';
import type { SiteAsset } from '../../../shared/site-content.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { siteAssets, sitePages, sitePageVersions } from '../../infrastructure/db/schema.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import { AuditService } from '../audit/audit-service.js';
import type { RequestAuditContext } from '../organizations/organization-service.js';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedFormats = new Set(['jpeg', 'png', 'webp']);
const maximumUploadBytes = 5 * 1024 * 1024;

function response(asset: typeof siteAssets.$inferSelect): SiteAsset {
  return {
    createdAt: asset.createdAt.toISOString(),
    filename: asset.filename,
    height: asset.height,
    id: asset.id,
    mimeType: 'image/webp',
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    thumbnailUrl: `/api/v1/site-assets/${asset.id}?variant=thumbnail`,
    url: `/api/v1/site-assets/${asset.id}`,
    width: asset.width,
  };
}

function containsAsset(value: unknown, assetId: string): boolean {
  if (value === assetId) return true;
  if (Array.isArray(value)) return value.some((item) => containsAsset(item, assetId));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsAsset(item, assetId));
  }
  return false;
}

export class SiteAssetsService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageDriver,
  ) {
    this.audit = new AuditService(database);
  }

  public async list(): Promise<readonly SiteAsset[]> {
    const assets = await this.database.orm.select().from(siteAssets).orderBy(siteAssets.createdAt);
    return assets.map(response);
  }

  public async upload(
    input: RequestAuditContext & {
      readonly bytes: Uint8Array;
      readonly filename: string;
      readonly mimeType: string;
    },
  ): Promise<SiteAsset> {
    if (!allowedMimeTypes.has(input.mimeType) || input.bytes.byteLength > maximumUploadBytes) {
      throw new AppError(
        'SITE_ASSET_INVALID',
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
      throw new AppError('SITE_ASSET_INVALID', 'The uploaded file is not a valid image.', 400);
    }
    if (
      !metadata.format ||
      !allowedFormats.has(metadata.format) ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new AppError('SITE_ASSET_INVALID', 'The uploaded file is not a supported image.', 400);
    }

    const normalized = await sharp(input.bytes, {
      animated: false,
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({ fit: 'inside', height: 2400, width: 2400, withoutEnlargement: true })
      .webp({ effort: 4, quality: 88 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(normalized.data)
      .resize({ fit: 'inside', height: 480, width: 480, withoutEnlargement: true })
      .webp({ effort: 4, quality: 80 })
      .toBuffer();
    const id = randomUUID();
    const objectKey = `public/brand/${id}/image.webp`;
    const thumbnailObjectKey = `public/brand/${id}/thumbnail.webp`;
    const sha256 = createHash('sha256').update(normalized.data).digest('hex');

    await this.storage.put({ data: normalized.data, key: objectKey });
    try {
      await this.storage.put({ data: thumbnail, key: thumbnailObjectKey });
      const [asset] = await this.database.orm
        .insert(siteAssets)
        .values({
          createdByUserId: input.actorUserId,
          filename: input.filename.slice(0, 255),
          height: normalized.info.height,
          id,
          mimeType: 'image/webp',
          objectKey,
          sha256,
          sizeBytes: normalized.data.byteLength,
          thumbnailObjectKey,
          width: normalized.info.width,
        })
        .returning();
      if (!asset) throw new Error('Site asset insert returned no row.');
      await this.audit.record({
        action: 'site-asset.uploaded',
        actorUserId: input.actorUserId,
        afterSummary: {
          filename: asset.filename,
          height: asset.height,
          sha256: asset.sha256,
          width: asset.width,
        },
        ipAddress: input.ipAddress,
        requestId: input.requestId,
        targetId: asset.id,
        targetType: 'site-asset',
      });
      return response(asset);
    } catch (error) {
      await Promise.allSettled([
        this.storage.delete(objectKey),
        this.storage.delete(thumbnailObjectKey),
      ]);
      throw error;
    }
  }

  public async open(assetId: string, thumbnail: boolean) {
    const [asset] = await this.database.orm
      .select()
      .from(siteAssets)
      .where(eq(siteAssets.id, assetId))
      .limit(1);
    if (!asset) throw new AppError('SITE_ASSET_NOT_FOUND', 'Image asset not found.', 404);
    return {
      asset: response(asset),
      stream: await this.storage.open(thumbnail ? asset.thumbnailObjectKey : asset.objectKey),
    };
  }

  public async delete(input: RequestAuditContext & { readonly assetId: string }): Promise<void> {
    const [asset] = await this.database.orm
      .select()
      .from(siteAssets)
      .where(eq(siteAssets.id, input.assetId))
      .limit(1);
    if (!asset) throw new AppError('SITE_ASSET_NOT_FOUND', 'Image asset not found.', 404);
    const activeVersions = await this.database.orm
      .select({ content: sitePageVersions.contentJson })
      .from(sitePages)
      .innerJoin(
        sitePageVersions,
        or(
          eq(sitePageVersions.id, sitePages.draftVersionId),
          eq(sitePageVersions.id, sitePages.publishedVersionId),
        ),
      )
      .where(eq(sitePages.slug, 'home'));
    if (activeVersions.some((version) => containsAsset(version.content, input.assetId))) {
      throw new AppError(
        'SITE_ASSET_IN_USE',
        'This image is used by the published homepage or current draft.',
        409,
      );
    }

    await this.database.orm.transaction(async (transaction) => {
      await transaction.delete(siteAssets).where(eq(siteAssets.id, input.assetId));
      await this.audit.record(
        {
          action: 'site-asset.deleted',
          actorUserId: input.actorUserId,
          beforeSummary: { filename: asset.filename, sha256: asset.sha256 },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: asset.id,
          targetType: 'site-asset',
        },
        transaction,
      );
    });
    await Promise.allSettled([
      this.storage.delete(asset.objectKey),
      this.storage.delete(asset.thumbnailObjectKey),
    ]);
  }
}
