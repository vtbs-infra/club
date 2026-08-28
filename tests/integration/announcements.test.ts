import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { SystemClock } from '../../src/server/infrastructure/clock/clock.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { announcementReads, users } from '../../src/server/infrastructure/db/schema/index.js';
import { AnnouncementService } from '../../src/server/modules/announcements/announcement-service.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

integration('announcement lifecycle', () => {
  let adminUserId: string;
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
    service = new AnnouncementService(database, new SystemClock());
  });

  afterAll(async () => {
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('tracks read state against the exact published version', async () => {
    const input = {
      body: '第一版内容',
      pinned: false,
      publicVisible: false,
      publishNow: true,
      severity: 'INFO' as const,
      title: '版本化公告',
    };
    const context = {
      actorUserId: adminUserId,
      ipAddress: '127.0.0.1',
      requestId: 'create-announcement',
    };
    const created = await service.create({ scope: 'PLATFORM' }, input, context);

    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: created.id, read: false, version: 1 },
    ]);
    await service.markRead(recipientUserId, created.id);
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: created.id, read: true, version: 1 },
    ]);

    const updated = await service.update(
      { scope: 'PLATFORM' },
      created.id,
      { ...input, body: '第二版内容', expectedVersion: created.version },
      { ...context, requestId: 'update-announcement' },
    );
    expect(updated.version).toBe(2);
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: created.id, read: false, version: 2 },
    ]);

    await service.markRead(recipientUserId, created.id);
    expect(await service.listVisible(recipientUserId)).toMatchObject([
      { id: created.id, read: true, version: 2 },
    ]);
    expect(
      (
        await database.orm
          .select({ value: count() })
          .from(announcementReads)
          .where(
            and(
              eq(announcementReads.announcementId, created.id),
              eq(announcementReads.userId, recipientUserId),
            ),
          )
      )[0]?.value,
    ).toBe(2);
  });
});
