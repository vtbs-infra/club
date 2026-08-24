import { afterAll, beforeAll, expect, it } from 'vitest';

import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { creators, users } from '../../src/server/infrastructure/db/schema/index.js';
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  integration,
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
      .values({ email: 'creator@example.com', name: 'Creator', role: 'CREATOR' })
      .returning({ id: users.id });
    creatorUserId = account!.id;
    const [creator] = await database.orm
      .insert(creators)
      .values({
        bilibiliUid: '90001',
        displayName: 'Creator',
        roomId: '80001',
        userId: creatorUserId,
      })
      .returning({ id: creators.id });
    creatorId = creator!.id;
    releaseService = new GiftReleaseService(database);
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
  });
});
