import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { announcements, users } from '../../src/server/infrastructure/db/schema/index.js';
import { AnnouncementService } from '../../src/server/modules/announcements/announcement-service.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

const target = { scope: 'PLATFORM' as const };
const input = {
  body: '第一版内容',
  title: '公告',
  publicVisible: false,
  pinned: false,
  severity: 'INFO' as const,
};
const clock = { now: () => new Date('2026-08-01T00:00:00Z') };

describe('announcement publication and reading', () => {
  let fixture: IntegrationDatabase;
  let service: AnnouncementService;
  let adminId: string;
  let recipientId: string;
  const context = () => ({ actorUserId: adminId });
  const visible = async () => (await service.listVisible(recipientId, { limit: 20 })).items;

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('announcements');
  });
  beforeEach(async () => {
    await fixture.database.orm.execute(sql`truncate users cascade`);
    const accounts = await fixture.database.orm
      .insert(users)
      .values([
        { username: 'admin', name: 'Admin', role: 'PLATFORM_ADMIN' },
        { username: 'recipient', name: 'Recipient', bilibiliUid: '100001' },
      ])
      .returning();
    adminId = accounts[0]!.id;
    recipientId = accounts[1]!.id;
    service = new AnnouncementService(fixture.database, clock);
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('requires explicit publication and preserves history after withdrawal', async () => {
    const draft = await service.createDraft(target, input, context());
    expect(await visible()).toEqual([]);
    const published = await service.publish(target, draft.id, draft.version, context());
    expect((await visible()).map((row) => row.id)).toEqual([draft.id]);
    const withdrawn = await service.withdraw(target, draft.id, published.version, context());
    const edited = await service.saveContent(
      target,
      draft.id,
      {
        ...input,
        body: '撤下后编辑的内容',
        expectedVersion: withdrawn.version,
      },
      context(),
    );
    expect(edited.status).toBe('WITHDRAWN');
    expect(await visible()).toEqual([]);
    await expect(service.deleteDraft(target, draft.id, context())).rejects.toMatchObject({
      code: 'ANNOUNCEMENT_NOT_DELETABLE',
    });
    await expect(
      fixture.database.orm.delete(announcements).where(eq(announcements.id, draft.id)),
    ).rejects.toThrow();
    await expect(
      fixture.database.orm
        .update(announcements)
        .set({
          status: 'DRAFT',
          publishedAt: null,
          withdrawnAt: null,
          version: edited.version + 1,
        })
        .where(eq(announcements.id, draft.id)),
    ).rejects.toThrow();
    await service.publish(target, draft.id, edited.version, context());
    expect(await service.getVisible(recipientId, draft.id)).toMatchObject({
      body: edited.body,
      read: false,
    });
  });

  it('acknowledges the displayed body without consuming a later version', async () => {
    const [published] = await fixture.database.orm
      .insert(announcements)
      .values({
        ...input,
        ...target,
        status: 'PUBLISHED',
        publishedAt: clock.now(),
        version: 7,
        createdByUserId: adminId,
      })
      .returning();
    await service.markRead(recipientId, published!.id, published!.version);
    expect(await visible()).toMatchObject([{ id: published!.id, read: true }]);
    const edited = await service.saveContent(
      target,
      published!.id,
      {
        ...input,
        body: '下一版内容',
        expectedVersion: published!.version,
      },
      context(),
    );
    await service.markRead(recipientId, published!.id, published!.version);
    expect(await visible()).toMatchObject([{ id: published!.id, read: false }]);
    await expect(
      service.markRead(recipientId, published!.id, edited.version + 1),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_READ_VERSION_INVALID' });
    await service.markRead(recipientId, published!.id, edited.version);
    expect(await visible()).toMatchObject([{ id: published!.id, read: true }]);
  });

  it('paginates timestamps with database microseconds without losing entries', async () => {
    const records = await fixture.database.orm
      .insert(announcements)
      .values(
        ['One', 'Two'].map((title) => ({
          ...input,
          ...target,
          title,
          createdByUserId: adminId,
          createdAt: sql`'2030-01-01 00:00:00.123456+00'::timestamptz`,
        })),
      )
      .returning();
    const first = await service.listManaged(target, { limit: 1 });
    const second = await service.listManaged(target, { limit: 1, cursor: first.nextCursor! });
    expect(new Set([...first.items, ...second.items].map((row) => row.id))).toEqual(
      new Set(records.map((row) => row.id)),
    );
  });
});
