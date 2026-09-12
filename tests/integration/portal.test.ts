import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  announcements,
  giftReleases,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import { PortalService } from '../../src/server/modules/portal/portal-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

describe('public portal visibility', () => {
  let fixture: IntegrationDatabase;
  beforeAll(async () => {
    fixture = await createIntegrationDatabase('portal');
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('shows published public content independently of monthly collection settings', async () => {
    const database = fixture.database.orm;
    const now = new Date('2026-08-15T00:00:00Z');
    const [owner] = await database
      .insert(users)
      .values({
        username: 'creator',
        name: 'Creator',
        role: 'CREATOR',
        bilibiliUid: '91001',
      })
      .returning();
    const creator = await insertTestCreator(fixture.database, {
      userId: owner!.id,
      bilibiliUid: '91001',
      displayName: 'Creator',
      roomId: '81001',
      monthlySyncEnabled: false,
    });
    const release = {
      creatorId: creator.id,
      createdByUserId: owner!.id,
      title: 'Public gift',
      publicVisible: true,
      publishedAt: new Date('2026-08-01T00:00:00Z'),
      status: 'PUBLISHED' as const,
      claimStartAt: new Date('2026-08-01T00:00:00Z'),
      claimDeadlineAt: new Date('2026-09-01T00:00:00Z'),
    };
    const [visibleRelease] = await database
      .insert(giftReleases)
      .values([
        { ...release, eligibilityMonth: '2026-08-01' },
        { ...release, eligibilityMonth: '2026-09-01', publicVisible: false },
        { ...release, eligibilityMonth: '2026-10-01', status: 'DRAFT', publishedAt: null },
      ])
      .returning();
    const announcement = {
      scope: 'PLATFORM' as const,
      createdByUserId: owner!.id,
      title: 'Public notice',
      body: 'Notice body',
      status: 'PUBLISHED' as const,
      publishedAt: new Date('2026-08-01T00:00:00Z'),
      publicVisible: true,
    };
    const [visibleAnnouncement] = await database
      .insert(announcements)
      .values([
        announcement,
        { ...announcement, publicVisible: false },
        { ...announcement, status: 'DRAFT', publishedAt: null },
      ])
      .returning();

    const portal = await new PortalService(fixture.database, { now: () => now }).getHome();
    expect(portal.releases.map((row) => row.id)).toEqual([visibleRelease!.id]);
    expect(portal.announcements.map((row) => row.id)).toEqual([visibleAnnouncement!.id]);
  });
});
