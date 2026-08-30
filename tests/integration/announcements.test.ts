import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import {
  announcementReads,
  announcements,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import { AnnouncementService } from '../../src/server/modules/announcements/announcement-service.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

class MutableClock implements Clock {
  public constructor(public current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }
}

integration('announcement lifecycle', () => {
  let adminUserId: string;
  let clock: MutableClock;
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let recipientUserId: string;
  let service: AnnouncementService;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('announcements');
    database = integrationDatabase.database;
    const accounts = await database.orm
      .insert(users)
      .values([
        { email: 'admin@example.com', name: 'Admin', role: 'PLATFORM_ADMIN' },
        { email: 'recipient@example.com', name: 'Recipient', role: 'USER' },
      ])
      .returning({ email: users.email, id: users.id });
    adminUserId = accounts.find((account) => account.email === 'admin@example.com')!.id;
    recipientUserId = accounts.find((account) => account.email === 'recipient@example.com')!.id;
    clock = new MutableClock(new Date('2026-08-01T00:00:00.000Z'));
    service = new AnnouncementService(database, clock);
  });

  afterAll(async () => {
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('keeps publication state explicit and read state versioned across the full lifecycle', async () => {
    const input = {
      body: '第一版内容',
      expiresAt: null,
      pinned: false,
      publicVisible: false,
      severity: 'INFO' as const,
      title: '版本化公告',
    };
    const context = {
      actorUserId: adminUserId,
      ipAddress: '127.0.0.1',
      requestId: 'create-announcement',
    };
    const target = { scope: 'PLATFORM' as const };
    const draft = await service.createDraft(target, input, context);

    expect(draft).toMatchObject({
      publishedAt: null,
      status: 'DRAFT',
      version: 1,
      withdrawnAt: null,
    });
    expect(await service.listVisible(recipientUserId)).toEqual([]);

    const published = await service.publish(target, draft.id, draft.version, {
      ...context,
      requestId: 'publish-announcement',
    });
    expect(published).toMatchObject({
      publishedAt: clock.current,
      status: 'PUBLISHED',
      version: 2,
      withdrawnAt: null,
    });
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: draft.id, read: false, version: 2 },
    ]);

    await service.markRead(recipientUserId, draft.id);
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: draft.id, read: true, version: 2 },
    ]);

    clock.current = new Date('2026-08-01T01:00:00.000Z');
    const updated = await service.saveContent(
      target,
      draft.id,
      { ...input, body: '第二版内容', expectedVersion: published.version },
      { ...context, requestId: 'update-published-announcement' },
    );
    expect(updated).toMatchObject({
      body: '第二版内容',
      publishedAt: published.publishedAt,
      status: 'PUBLISHED',
      version: 3,
      withdrawnAt: null,
    });
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: draft.id, read: false, version: 3 },
    ]);

    await service.markRead(recipientUserId, draft.id);
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: draft.id, read: true, version: 3 },
    ]);
    expect(
      (
        await database.orm
          .select({ value: count() })
          .from(announcementReads)
          .where(
            and(
              eq(announcementReads.announcementId, draft.id),
              eq(announcementReads.userId, recipientUserId),
            ),
          )
      )[0]?.value,
    ).toBe(2);

    clock.current = new Date('2026-08-01T02:00:00.000Z');
    const withdrawn = await service.withdraw(target, draft.id, updated.version, {
      ...context,
      requestId: 'withdraw-announcement',
    });
    expect(withdrawn).toMatchObject({
      publishedAt: published.publishedAt,
      status: 'WITHDRAWN',
      version: 4,
      withdrawnAt: clock.current,
    });
    expect(await service.listVisible(recipientUserId)).toEqual([]);
    await expect(
      service.deleteDraft(target, draft.id, {
        ...context,
        requestId: 'delete-withdrawn-announcement',
      }),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_NOT_DELETABLE', statusCode: 409 });

    const editedWhileWithdrawn = await service.saveContent(
      target,
      draft.id,
      { ...input, body: '撤下后修订的内容', expectedVersion: withdrawn.version },
      { ...context, requestId: 'update-withdrawn-announcement' },
    );
    expect(editedWhileWithdrawn).toMatchObject({
      status: 'WITHDRAWN',
      version: 5,
      withdrawnAt: withdrawn.withdrawnAt,
    });

    clock.current = new Date('2026-08-02T00:00:00.000Z');
    const republished = await service.publish(target, draft.id, editedWhileWithdrawn.version, {
      ...context,
      requestId: 'republish-announcement',
    });
    expect(republished).toMatchObject({
      publishedAt: clock.current,
      status: 'PUBLISHED',
      version: 6,
      withdrawnAt: null,
    });
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { body: '撤下后修订的内容', id: draft.id, read: false, version: 6 },
    ]);

    await expect(
      database.orm
        .update(announcements)
        .set({ publishedAt: null, status: 'DRAFT', version: republished.version + 1 })
        .where(eq(announcements.id, draft.id)),
    ).rejects.toMatchObject({ cause: { code: 'P0001' } });
    await expect(
      database.orm.delete(announcements).where(eq(announcements.id, draft.id)),
    ).rejects.toMatchObject({ cause: { code: 'P0001' } });
  });
});
