import { randomUUID } from 'node:crypto';

import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { users } from '../../src/server/infrastructure/db/schema/index.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import { AddressService } from '../../src/server/modules/addresses/address-service.js';
import { RoomConnectionManager } from '../../src/server/modules/bilibili/room-connection-manager.js';
import { VerificationRoomService } from '../../src/server/modules/verification-rooms/verification-room-service.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';

describe('serialized settings changes', () => {
  let fixture: IntegrationDatabase;
  const actorUserId = randomUUID();
  const connections = new RoomConnectionManager({
    source: new FakeLiveMessageSource(),
    onMessage: () => undefined,
  });
  beforeAll(async () => {
    fixture = await createIntegrationDatabase('settings_concurrency');
    await fixture.database.orm.insert(users).values({
      id: actorUserId,
      name: 'Admin',
      email: 'admin@example.com',
      role: 'PLATFORM_ADMIN',
    });
  });
  afterAll(async () => {
    await connections.close();
    await fixture?.cleanup();
  });

  async function holdLock(statement: SQL) {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const completed = fixture.database.orm.transaction(async (transaction) => {
      await transaction.execute(statement);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    return { release: release.resolve, completed };
  }

  async function waitForBlockedWriters() {
    await vi.waitFor(async () => {
      const rows = await fixture.database.orm.execute(
        sql`select count(*)::int as total from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      );
      expect(rows[0]?.total).toBeGreaterThanOrEqual(2);
    });
  }

  it('serializes changes to different default addresses without a deadlock', async () => {
    const service = new AddressService(fixture.database, new EncryptionKeyRing(createTestConfig()));
    const payload = {
      countryRegion: '中国大陆',
      province: '上海市',
      city: '上海市',
      district: '浦东新区',
      detailedAddress: '测试路 1 号',
      recipientName: '测试',
      phone: '13800138000',
      postalCode: '',
      userNote: '',
    };
    const first = await service.create(
      actorUserId,
      { isDefault: true, label: 'A', payload },
      { actorUserId },
    );
    const second = await service.create(
      actorUserId,
      { isDefault: false, label: 'B', payload },
      { actorUserId },
    );
    const lock = await holdLock(sql`select id from users where id = ${actorUserId} for update`);
    const writes = Promise.allSettled([
      service.update(actorUserId, first.id, { isDefault: true }, { actorUserId }),
      service.update(actorUserId, second.id, { isDefault: true }, { actorUserId }),
    ]);
    try {
      await waitForBlockedWriters();
    } finally {
      lock.release();
      await lock.completed;
    }
    expect((await writes).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await service.list(actorUserId)).filter((address) => address.isDefault)).toHaveLength(
      1,
    );
  });

  it('preserves concurrent partial edits without restoring stale enabled state', async () => {
    const service = new VerificationRoomService(fixture.database, connections);
    const room = await service.create({
      actorUserId,
      biliRoomId: '81000',
      displayName: 'Original',
      enabled: true,
      priority: 1,
    });
    const lock = await holdLock(
      sql`select id from verification_rooms where id = ${room.id} for update`,
    );
    const writes = Promise.allSettled([
      service.update({ actorUserId, roomId: room.id, displayName: 'Renamed' }),
      service.update({ actorUserId, roomId: room.id, enabled: false }),
    ]);
    try {
      await waitForBlockedWriters();
    } finally {
      lock.release();
      await lock.completed;
    }
    expect((await writes).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await service.list()).find((item) => item.id === room.id)).toMatchObject({
      displayName: 'Renamed',
      enabled: false,
      priority: 1,
    });
  });

  it('returns a conflict for duplicate rooms through the real database error wrapper', async () => {
    const service = new VerificationRoomService(fixture.database, connections);
    const input = {
      actorUserId,
      biliRoomId: '82000',
      displayName: 'Duplicate',
      enabled: true,
      priority: 1,
    };
    await service.create(input);
    await expect(service.create(input)).rejects.toMatchObject({
      code: 'VERIFICATION_ROOM_CONFLICT',
      statusCode: 409,
    });
    expect(
      (await service.list()).filter((room) => room.biliRoomId === input.biliRoomId),
    ).toHaveLength(1);
  });
});
