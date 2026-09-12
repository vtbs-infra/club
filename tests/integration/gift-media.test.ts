import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { giftCoverObjects, users } from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { GiftMediaService } from '../../src/server/modules/gifts/gift-media-service.js';
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

const clock = { now: () => new Date('2026-08-01T00:00:00Z') };

describe('gift cover ownership and cleanup', () => {
  let fixture: IntegrationDatabase;
  let storage: TemporaryStorage;
  let media: GiftMediaService;
  let releases: GiftReleaseService;
  let creatorId: string;
  let userId: string;
  let draftId: string;
  let image: Buffer;
  const context = () => ({ actorUserId: userId });
  const upload = () =>
    media.uploadCover(creatorId, draftId, { ...context(), bytes: image, mimeType: 'image/png' });
  const open = () => media.openCover(draftId, { role: 'CREATOR', userId });

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('gift_media');
    image = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 80, g: 120, b: 180, alpha: 1 } },
    })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    await fixture.database.orm.execute(sql`truncate users cascade`);
    storage = await createTemporaryStorage();
    media = new GiftMediaService(fixture.database, storage.driver, clock);
    releases = new GiftReleaseService(fixture.database, clock);
    const [user] = await fixture.database.orm
      .insert(users)
      .values({ username: 'creator', name: 'Creator', role: 'CREATOR', bilibiliUid: '910001' })
      .returning();
    userId = user!.id;
    creatorId = (
      await insertTestCreator(fixture.database, {
        userId,
        bilibiliUid: '910001',
        roomId: '810001',
        displayName: 'Creator',
      })
    ).id;
    draftId = (await releases.create(creatorId, createReleaseDraft('2026-07-01'), context())).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await storage?.cleanup();
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('rejects invalid image bytes before allocating an object', async () => {
    await expect(
      media.uploadCover(creatorId, draftId, {
        ...context(),
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'GIFT_COVER_INVALID' });
    expect(await fixture.database.orm.select().from(giftCoverObjects)).toEqual([]);
  });

  it('keeps the active cover when a replacement upload fails and reclaims the staged object', async () => {
    await upload();
    const [original] = await fixture.database.orm.select().from(giftCoverObjects);
    vi.spyOn(storage.driver, 'put').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(upload()).rejects.toThrow('storage unavailable');
    await (await open()).cancel();
    expect(await media.cleanupObjects(new Date(clock.now().getTime() + 1))).toBe(1);
    expect(await fixture.database.orm.select().from(giftCoverObjects)).toEqual([original]);
  });

  it('retries obsolete-object deletion without removing the replacement cover', async () => {
    await upload();
    const [original] = await fixture.database.orm.select().from(giftCoverObjects);
    await upload();
    vi.spyOn(storage.driver, 'delete').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(media.cleanupObjects(clock.now())).rejects.toThrow();
    await (await open()).cancel();
    expect(
      await fixture.database.orm
        .select()
        .from(giftCoverObjects)
        .where(eq(giftCoverObjects.objectKey, original!.objectKey)),
    ).toHaveLength(1);
    expect(await media.cleanupObjects(clock.now())).toBe(1);
    await expect(storage.driver.open(original!.objectKey)).rejects.toThrow();
    await (await open()).cancel();
  });

  it.each(['cover', 'draft'] as const)(
    'reclaims the object after its %s is removed',
    async (removed) => {
      await upload();
      if (removed === 'cover') await media.removeCover(creatorId, draftId, context());
      else await releases.removeDraft(creatorId, draftId, context());
      await expect(open()).rejects.toMatchObject({ code: 'GIFT_COVER_NOT_FOUND' });
      expect(await media.cleanupObjects(clock.now())).toBe(1);
      expect(await fixture.database.orm.select().from(giftCoverObjects)).toEqual([]);
    },
  );
});
