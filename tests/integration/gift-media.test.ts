import { count, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';

import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  giftCoverObjects,
  giftReleases,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import type {
  PutFileInput,
  StorageDriver,
} from '../../src/server/infrastructure/storage/storage-driver.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { GiftMediaService } from '../../src/server/modules/gifts/gift-media-service.js';
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

class MutableClock implements Clock {
  public constructor(public current: Date) {}
  public now(): Date {
    return this.current;
  }
}

integration('gift cover object lifecycle', () => {
  let clock: MutableClock;
  let creatorId: string;
  let database: DatabaseService;
  let failNextDelete = false;
  let failNextPut = false;
  let integrationDatabase: IntegrationDatabase;
  let media: GiftMediaService;
  let release: GiftReleaseService;
  let storage: TemporaryStorage;
  let userId: string;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('gift_media');
    database = integrationDatabase.database;
    storage = await createTemporaryStorage();
    clock = new MutableClock(new Date('2026-08-31T08:00:00.000Z'));
    const controlledStorage: StorageDriver = {
      checkHealth: () => storage.driver.checkHealth(),
      cleanupStaleTemporaryObjects: (olderThan) =>
        storage.driver.cleanupStaleTemporaryObjects(olderThan),
      delete: async (key) => {
        if (failNextDelete) {
          failNextDelete = false;
          throw new Error('Object deletion is temporarily unavailable.');
        }
        await storage.driver.delete(key);
      },
      open: (key) => storage.driver.open(key),
      put: async (input: PutFileInput) => {
        if (failNextPut) {
          failNextPut = false;
          throw new Error('Object upload is temporarily unavailable.');
        }
        return storage.driver.put(input);
      },
    };
    media = new GiftMediaService(database, controlledStorage, clock);
    release = new GiftReleaseService(database, clock);
    const [user] = await database.orm
      .insert(users)
      .values({ email: 'gift-media@example.com', name: 'Gift Media Creator', role: 'CREATOR' })
      .returning({ id: users.id });
    userId = user!.id;
    const creator = await insertTestCreator(database, {
      bilibiliUid: '950001',
      displayName: 'Gift Media Creator',
      roomId: '1950001',
      userId,
    });
    creatorId = creator.id;
  });

  afterAll(async () => {
    await storage.cleanup();
    await integrationDatabase.cleanup();
  });

  it('recovers staged, replaced, removed, and draft-owned cover objects', async () => {
    const context = {
      actorUserId: userId,
      ipAddress: '127.0.0.1',
      requestId: 'gift-media-lifecycle',
    };
    const draft = await release.create(creatorId, createReleaseDraft('2026-08-01'), context);
    await expect(
      media.uploadCover(creatorId, draft.id, {
        ...context,
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'GIFT_COVER_INVALID' });
    const [afterInvalid] = await database.orm.select({ value: count() }).from(giftCoverObjects);
    expect(afterInvalid?.value).toBe(0);

    const image = await sharp({
      create: {
        background: { alpha: 1, b: 180, g: 120, r: 80 },
        channels: 4,
        height: 4,
        width: 4,
      },
    })
      .png()
      .toBuffer();
    await media.uploadCover(creatorId, draft.id, {
      ...context,
      bytes: image,
      mimeType: 'image/png',
    });
    const [first] = await database.orm
      .select()
      .from(giftCoverObjects)
      .where(eq(giftCoverObjects.giftReleaseId, draft.id));
    expect(first).toMatchObject({ giftReleaseId: draft.id, state: 'ACTIVE' });
    expect((await release.get(creatorId, draft.id)).coverImageUrl).toBe(
      `/api/v1/gift-releases/${draft.id}/cover`,
    );
    const opened = await media.openCover(draft.id, { role: 'CREATOR', userId });
    await opened.cancel();

    clock.current = new Date('2026-08-31T08:01:00.000Z');
    await media.uploadCover(creatorId, draft.id, {
      ...context,
      bytes: image,
      mimeType: 'image/png',
    });
    const objectsAfterReplacement = await database.orm.select().from(giftCoverObjects);
    const replacement = objectsAfterReplacement.find((object) => object.state === 'ACTIVE')!;
    expect(replacement.giftReleaseId).toBe(draft.id);
    expect(objectsAfterReplacement).toContainEqual(
      expect.objectContaining({
        giftReleaseId: null,
        objectKey: first!.objectKey,
        state: 'DELETE_PENDING',
      }),
    );

    failNextDelete = true;
    await expect(media.cleanupObjects(clock.current)).rejects.toThrow(
      'One or more gift cover objects could not be cleaned.',
    );
    expect(
      await database.orm
        .select()
        .from(giftCoverObjects)
        .where(eq(giftCoverObjects.objectKey, first!.objectKey)),
    ).toHaveLength(1);
    expect(await media.cleanupObjects(clock.current)).toBe(1);
    await expect(storage.driver.open(first!.objectKey)).rejects.toThrow();

    await media.removeCover(creatorId, draft.id, context);
    await expect(media.openCover(draft.id, { role: 'CREATOR', userId })).rejects.toMatchObject({
      code: 'GIFT_COVER_NOT_FOUND',
    });
    expect(await media.cleanupObjects(clock.current)).toBe(1);

    failNextPut = true;
    await expect(
      media.uploadCover(creatorId, draft.id, {
        ...context,
        bytes: image,
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('Object upload is temporarily unavailable.');
    const [staged] = await database.orm
      .select()
      .from(giftCoverObjects)
      .where(eq(giftCoverObjects.state, 'STAGED'));
    expect(staged).toMatchObject({ giftReleaseId: null, state: 'STAGED' });
    expect(await media.cleanupObjects(new Date(clock.current.getTime() + 1))).toBe(1);

    await media.uploadCover(creatorId, draft.id, {
      ...context,
      bytes: image,
      mimeType: 'image/png',
    });
    const [draftCover] = await database.orm
      .select()
      .from(giftCoverObjects)
      .where(eq(giftCoverObjects.giftReleaseId, draft.id));
    await release.removeDraft(creatorId, draft.id, context);
    expect(
      await database.orm.select().from(giftReleases).where(eq(giftReleases.id, draft.id)),
    ).toHaveLength(0);
    expect(
      await database.orm
        .select()
        .from(giftCoverObjects)
        .where(eq(giftCoverObjects.objectKey, draftCover!.objectKey)),
    ).toEqual([expect.objectContaining({ giftReleaseId: null, state: 'DELETE_PENDING' })]);
    expect(await media.cleanupObjects(clock.current)).toBe(1);
    expect(await database.orm.select().from(giftCoverObjects)).toEqual([]);
  });
});
