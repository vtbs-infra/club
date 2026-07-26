import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  announcementReads,
  announcements,
  bilibiliBindings,
  bindingChallenges,
  creators,
  entitlements,
  giftCampaigns,
  giftPackages,
  organizationMembers,
  organizations,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { AnnouncementService } from '../../src/server/modules/announcements/announcement-service.js';
import type { FulfillmentRuntime } from '../../src/server/modules/fulfillment/fulfillment-runtime.js';
import type { SnapshotRuntime } from '../../src/server/modules/snapshots/snapshot-runtime.js';
import { SystemStatusService } from '../../src/server/modules/system-status/system-status-service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration('announcements and operational diagnostics', () => {
  let database: DatabaseService;
  let storage: TemporaryStorage;
  let service: AnnouncementService;
  let ownerId: string;
  let memberId: string;
  let recipientId: string;
  let outsiderId: string;
  let organizationAId: string;
  let organizationBId: string;
  let creatorAId: string;
  let creatorBId: string;
  let campaignAId: string;
  const publishedAt = new Date('2026-06-01T00:00:00.000Z');

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    storage = await createTemporaryStorage();
    service = new AnnouncementService(database);
    await database.orm.execute(
      sql`TRUNCATE TABLE users, organizations, verification_rooms CASCADE`,
    );

    const insertedUsers = await database.orm
      .insert(users)
      .values([
        { email: 'm7-owner@example.com', name: 'M7 Owner' },
        { email: 'm7-member@example.com', name: 'M7 Member' },
        { email: 'm7-recipient@example.com', name: 'M7 Recipient' },
        { email: 'm7-outsider@example.com', name: 'M7 Outsider' },
      ])
      .returning({ email: users.email, id: users.id });
    ownerId = insertedUsers.find((user) => user.email === 'm7-owner@example.com')!.id;
    memberId = insertedUsers.find((user) => user.email === 'm7-member@example.com')!.id;
    recipientId = insertedUsers.find((user) => user.email === 'm7-recipient@example.com')!.id;
    outsiderId = insertedUsers.find((user) => user.email === 'm7-outsider@example.com')!.id;

    const insertedOrganizations = await database.orm
      .insert(organizations)
      .values([
        { name: 'M7 Organization A', slug: 'm7-organization-a' },
        { name: 'M7 Organization B', slug: 'm7-organization-b' },
      ])
      .returning({ id: organizations.id, slug: organizations.slug });
    organizationAId = insertedOrganizations.find(
      (organization) => organization.slug === 'm7-organization-a',
    )!.id;
    organizationBId = insertedOrganizations.find(
      (organization) => organization.slug === 'm7-organization-b',
    )!.id;
    await database.orm.insert(organizationMembers).values([
      { organizationId: organizationAId, role: 'OWNER', userId: ownerId },
      { organizationId: organizationAId, role: 'VIEWER', userId: memberId },
    ]);
    const insertedCreators = await database.orm
      .insert(creators)
      .values([
        {
          bilibiliUid: 'm7-creator-a',
          displayName: 'M7 Creator A',
          organizationId: organizationAId,
          roomId: 'm7-room-a',
          timezone: 'Asia/Shanghai',
        },
        {
          bilibiliUid: 'm7-creator-b',
          displayName: 'M7 Creator B',
          organizationId: organizationBId,
          roomId: 'm7-room-b',
          timezone: 'Asia/Shanghai',
        },
      ])
      .returning({ id: creators.id, organizationId: creators.organizationId });
    creatorAId = insertedCreators.find((creator) => creator.organizationId === organizationAId)!.id;
    creatorBId = insertedCreators.find((creator) => creator.organizationId === organizationBId)!.id;
    const [campaign] = await database.orm
      .insert(giftCampaigns)
      .values({
        claimDeadlineAt: new Date('2026-08-01T00:00:00.000Z'),
        claimFormSchema: [],
        claimStartAt: new Date('2026-07-01T00:00:00.000Z'),
        createdBy: ownerId,
        creatorId: creatorAId,
        description: 'M7 campaign',
        fulfillmentMode: 'HIGHEST_ONLY',
        organizationId: organizationAId,
        periodStart: '2026-06-01',
        title: 'M7 Campaign A',
      })
      .returning({ id: giftCampaigns.id });
    campaignAId = campaign!.id;

    const [run] = await database.orm
      .insert(snapshotRuns)
      .values({
        creatorBilibiliUid: 'm7-creator-a',
        creatorId: creatorAId,
        creatorRoomId: 'm7-room-a',
        cutoffTimezone: 'Asia/Shanghai',
        onTimeWindowEndAt: new Date('2026-07-01T00:00:00.000Z'),
        organizationId: organizationAId,
        periodStart: '2026-06-01',
        scheduledCutoffAt: new Date('2026-06-30T23:59:00.000Z'),
      })
      .returning({ id: snapshotRuns.id });
    const [snapshotMember] = await database.orm
      .insert(snapshotMembers)
      .values({
        biliUid: 'm7-recipient-uid',
        displayNameAtSnapshot: 'Historical Recipient',
        rawTier: '3',
        snapshotRunId: run!.id,
        sourcePosition: 1,
        tier: 'CAPTAIN',
      })
      .returning({ id: snapshotMembers.id });
    const [giftPackage] = await database.orm
      .insert(giftPackages)
      .values({ campaignId: campaignAId, name: 'M7 Package' })
      .returning({ id: giftPackages.id });
    await database.orm.insert(entitlements).values({
      biliUid: 'm7-recipient-uid',
      campaignId: campaignAId,
      creatorId: creatorAId,
      giftPackageId: giftPackage!.id,
      organizationId: organizationAId,
      snapshotMemberId: snapshotMember!.id,
      tier: 'CAPTAIN',
    });
    const [room] = await database.orm
      .insert(verificationRooms)
      .values({
        biliOwnerUid: 'm7-room-owner',
        biliRoomId: 'm7-verification-room',
        displayName: 'M7 Verification',
      })
      .returning({ id: verificationRooms.id });
    const [challenge] = await database.orm
      .insert(bindingChallenges)
      .values({
        codeDigest: 'm7-digest',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        status: 'CONSUMED',
        userId: recipientId,
        verificationRoomId: room!.id,
      })
      .returning({ id: bindingChallenges.id });
    await database.orm.insert(bilibiliBindings).values({
      biliUid: 'm7-recipient-uid',
      challengeId: challenge!.id,
      unboundAt: new Date('2026-07-02T00:00:00.000Z'),
      userId: recipientId,
    });
  });

  afterAll(async () => {
    if (database) await database.close();
    if (storage) await storage.cleanup();
  });

  const context = () => ({ actorUserId: ownerId, requestId: 'm7-test' });

  it('enforces all scopes, historical entitlement visibility, and organization isolation', async () => {
    const platform = await service.createPlatform(
      {
        body: 'Visible to every authenticated user.',
        pinned: true,
        publishedAt,
        severity: 'INFO',
        title: 'Platform',
      },
      context(),
    );
    const organization = await service.createOrganization(
      organizationAId,
      {
        body: 'Organization members only.',
        pinned: false,
        publishedAt,
        scope: 'ORGANIZATION',
        severity: 'INFO',
        title: 'Organization A',
      },
      context(),
    );
    const creator = await service.createOrganization(
      organizationAId,
      {
        body: 'Creator community.',
        creatorId: creatorAId,
        pinned: false,
        publishedAt,
        scope: 'CREATOR',
        severity: 'WARNING',
        title: 'Creator A',
      },
      context(),
    );
    const campaign = await service.createOrganization(
      organizationAId,
      {
        body: 'Campaign recipients.',
        campaignId: campaignAId,
        pinned: false,
        publishedAt,
        scope: 'CAMPAIGN',
        severity: 'CRITICAL',
        title: 'Campaign A',
      },
      context(),
    );
    await service.createOrganization(
      organizationBId,
      {
        body: 'Must not leak.',
        creatorId: creatorBId,
        pinned: false,
        publishedAt,
        scope: 'CREATOR',
        severity: 'CRITICAL',
        title: 'Creator B',
      },
      context(),
    );
    await service.createPlatform(
      {
        body: 'Future draft.',
        pinned: false,
        publishedAt: new Date('2099-01-01T00:00:00.000Z'),
        severity: 'INFO',
        title: 'Future',
      },
      context(),
    );

    expect((await service.listForUser(memberId)).map((item) => item.id)).toEqual(
      expect.arrayContaining([platform.id, organization.id, creator.id, campaign.id]),
    );
    const entitledIds = (await service.listForUser(recipientId)).map((item) => item.id);
    expect(entitledIds).toEqual(expect.arrayContaining([platform.id, creator.id, campaign.id]));
    expect(entitledIds).not.toContain(organization.id);
    expect((await service.listForUser(outsiderId)).map((item) => item.id)).toEqual([platform.id]);
  });

  it('persists idempotent read state and protects it from mutation', async () => {
    const [creatorNotice] = await database.orm
      .select()
      .from(announcements)
      .where(eq(announcements.title, 'Creator A'));
    const first = await service.markRead(recipientId, creatorNotice!.id);
    const second = await service.markRead(recipientId, creatorNotice!.id);
    expect(second.readAt).toBe(first.readAt);
    expect(
      (await service.listForUser(recipientId)).find((item) => item.id === creatorNotice!.id)
        ?.readAt,
    ).toBe(first.readAt);
    const [read] = await database.orm
      .select()
      .from(announcementReads)
      .where(eq(announcementReads.announcementId, creatorNotice!.id));
    await expect(
      database.orm
        .update(announcementReads)
        .set({ readAt: new Date('2099-01-01T00:00:00.000Z') })
        .where(eq(announcementReads.id, read!.id)),
    ).rejects.toThrow();
  });

  it('rejects cross-organization targets and stale updates while auditing publication', async () => {
    await expect(
      service.createOrganization(
        organizationAId,
        {
          body: 'Invalid target.',
          creatorId: creatorBId,
          pinned: false,
          publishedAt,
          scope: 'CREATOR',
          severity: 'INFO',
          title: 'Cross organization',
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_TARGET_INVALID' });
    await expect(
      service.createOrganization(
        organizationAId,
        {
          body: 'Organization-wide notice from a scoped manager.',
          pinned: false,
          publishedAt,
          scope: 'ORGANIZATION',
          severity: 'INFO',
          title: 'Scoped organization notice',
        },
        context(),
        [creatorAId],
      ),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_ACCESS_DENIED' });
    await expect(
      service.createOrganization(
        organizationAId,
        {
          body: 'Campaign outside the permitted creator scope.',
          campaignId: campaignAId,
          pinned: false,
          publishedAt,
          scope: 'CAMPAIGN',
          severity: 'INFO',
          title: 'Scoped campaign notice',
        },
        context(),
        [creatorBId],
      ),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_ACCESS_DENIED' });
    expect(
      (await service.listOrganization(organizationAId, [creatorAId])).every(
        (announcement) => announcement.scope === 'CREATOR' || announcement.scope === 'CAMPAIGN',
      ),
    ).toBe(true);
    const draft = await service.createOrganization(
      organizationAId,
      {
        body: 'Publish safely.',
        pinned: false,
        scope: 'ORGANIZATION',
        severity: 'INFO',
        title: 'Draft',
      },
      context(),
    );
    const published = await service.update(
      draft.id,
      { publishedAt, version: draft.version },
      context(),
    );
    expect(published.version).toBe(2);
    await expect(
      service.update(draft.id, { pinned: true, version: draft.version }, context()),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_VERSION_CONFLICT' });
  });

  it('reports missing raw objects without exposing storage keys or credentials', async () => {
    const [run] = await database.orm
      .select()
      .from(snapshotRuns)
      .where(eq(snapshotRuns.organizationId, organizationAId));
    const [attempt] = await database.orm
      .insert(snapshotAttempts)
      .values({
        attemptNumber: 1,
        failureCode: 'SOURCE_TIMEOUT',
        schedulerStartedAt: new Date('2026-06-30T23:59:00.000Z'),
        snapshotRunId: run!.id,
        sourceName: 'test-source',
        sourceVersion: '1',
      })
      .returning({ id: snapshotAttempts.id });
    await database.orm.insert(snapshotPages).values({
      compressedSize: 10,
      contentHashSha256: 'a'.repeat(64),
      fetchedAt: new Date('2026-06-30T23:59:30.000Z'),
      itemCount: 1,
      objectKey: 'private/raw/super-secret-snapshot.json.gz',
      pageNumber: 1,
      snapshotAttemptId: attempt!.id,
      uncompressedSize: 20,
    });
    const snapshotRuntime = {
      getStatus: () => ({ lastTickAt: publishedAt, running: true }),
    } as SnapshotRuntime;
    const fulfillmentRuntime = {
      getStatus: () => ({ configured: true, lastTickAt: publishedAt, running: true }),
    } as FulfillmentRuntime;
    const status = new SystemStatusService({
      database,
      fulfillmentRuntime,
      snapshotRuntime,
      storage: storage.driver,
      version: 'test',
    });
    const platform = await status.platform();
    const organization = await status.organization(organizationAId);
    expect(platform.integrityWarnings).toHaveLength(1);
    expect(platform.recentSnapshotFailures).toMatchObject([{ failureCode: 'SOURCE_TIMEOUT' }]);
    expect(organization.integrityWarningCount).toBe(1);
    expect(JSON.stringify({ platform, organization })).not.toContain('super-secret');
    expect(JSON.stringify({ platform, organization })).not.toContain('objectKey');
    expect(JSON.stringify({ platform, organization })).not.toContain('trackingNumber');
  });
});
