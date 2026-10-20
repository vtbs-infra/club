import { describe as integration, afterAll, beforeAll, expect, it } from 'vitest';

import { SystemClock } from '../../src/server/infrastructure/clock/clock.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { users } from '../../src/server/infrastructure/db/schema/index.js';
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

integration('gift release lifecycle', () => {
  let creatorId: string;
  let creatorUserId: string;
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let releaseService: GiftReleaseService;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('gift_releases');
    database = integrationDatabase.database;
    const [account] = await database.orm
      .insert(users)
      .values({ username: 'creator', bilibiliUid: '90001', name: 'Creator', role: 'CREATOR' })
      .returning({ id: users.id });
    creatorUserId = account!.id;
    creatorId = (
      await insertTestCreator(database, {
        bilibiliUid: '90001',
        displayName: 'Creator',
        roomId: '80001',
        userId: creatorUserId,
      })
    ).id;
    releaseService = new GiftReleaseService(database, new SystemClock());
  });

  afterAll(async () => {
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('atomically publishes current unsaved content with optimistic locking', async () => {
    const initial = createReleaseDraft('2026-08-01');
    const draft = await releaseService.create(
      creatorId,
      { ...initial, title: '保存过的旧标题' },
      { actorUserId: creatorUserId, ipAddress: '127.0.0.1', requestId: 'create-august' },
    );
    const published = await releaseService.publish(
      creatorId,
      draft.id,
      {
        ...initial,
        description: '直接发布时输入的新说明',
        expectedVersion: draft.version,
        title: '直接发布时输入的新标题',
      },
      {
        actorUserId: creatorUserId,
        ipAddress: '127.0.0.1',
        requestId: 'publish-august-current-content',
      },
    );

    expect(published).toMatchObject({
      description: '直接发布时输入的新说明',
      status: 'PUBLISHED',
      title: '直接发布时输入的新标题',
      version: draft.version + 1,
    });
    await expect(
      releaseService.publish(
        creatorId,
        draft.id,
        {
          ...initial,
          title: '另一页面尚未发布的内容',
          expectedVersion: draft.version,
        },
        { actorUserId: creatorUserId },
      ),
    ).rejects.toMatchObject({ code: 'GIFT_RELEASE_NOT_PUBLISHABLE' });
    expect((await releaseService.get(creatorId, draft.id)).title).toBe('直接发布时输入的新标题');
  });

  it('interprets the claim window in the time zone the form showed', async () => {
    // The creator's own zone is Asia/Shanghai; this form was filled in Los Angeles time.
    const context = { actorUserId: creatorUserId, ipAddress: '127.0.0.1', requestId: 'zones' };
    const release = await releaseService.create(
      creatorId,
      createReleaseDraft('2026-03-01', {
        claimDeadlineLocal: '2026-03-09T09:00',
        claimStartLocal: '2026-03-07T09:00',
        timeZone: 'America/Los_Angeles',
      }),
      context,
    );
    expect(new Date(release.claimStartAt).toISOString()).toBe('2026-03-07T17:00:00.000Z');
    expect(new Date(release.claimDeadlineAt).toISOString()).toBe('2026-03-09T16:00:00.000Z');

    for (const [overrides, code] of [
      [
        { claimStartLocal: '2026-03-08T02:30', timeZone: 'America/Los_Angeles' },
        'LOCAL_TIME_INVALID',
      ],
      [{ timeZone: '+08:00' }, 'TIME_ZONE_INVALID'],
    ] as const) {
      await expect(
        releaseService.create(creatorId, createReleaseDraft('2026-04-01', overrides), context),
      ).rejects.toMatchObject({ code });
    }
  });
});
