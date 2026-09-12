import { randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  giftOrderAddresses,
  giftOrderItems,
  giftOrders,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import { databaseWriteBatches } from '../../src/server/infrastructure/db/write-batches.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { GiftFulfillmentExportService } from '../../src/server/modules/gifts/fulfillment-export-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { insertFinalizedSnapshot } from '../helpers/snapshot-fixture.js';

describe('fulfillment capacity', () => {
  let fixture: IntegrationDatabase;
  beforeAll(async () => {
    fixture = await createIntegrationDatabase('fulfillment_capacity');
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('generates cumulative allocations and exports all 30,000 submitted gifts after closure', async () => {
    const total = 30_000;
    const database = fixture.database.orm;
    const [owner] = await database
      .insert(users)
      .values({ username: 'creator', name: 'Creator', bilibiliUid: '910001', role: 'CREATOR' })
      .returning();
    const creator = await insertTestCreator(fixture.database, {
      userId: owner!.id,
      bilibiliUid: '910001',
      roomId: '810001',
      displayName: 'Creator',
    });
    const periodStart = '2026-07-01';
    await insertFinalizedSnapshot(fixture.database, {
      creatorId: creator.id,
      periodStart,
      members: Array.from({ length: total }, (_, i) => ({
        biliUid: String(10000000 + i),
        tier: 'GOVERNOR',
      })),
    });
    const clock = { now: () => new Date('2026-08-01T00:00:00Z') };
    const releases = new GiftReleaseService(fixture.database, clock);
    const context = { actorUserId: owner!.id };
    const input = createReleaseDraft(periodStart, {
      fulfillmentMode: 'CUMULATIVE',
      packages: ['舰长', '提督', '总督'].map((tier) => ({
        name: `${tier}礼包`,
        description: '',
        items: [{ name: `${tier}徽章`, quantity: 1, description: '' }],
      })),
      tierPackageIndexes: { CAPTAIN: 0, ADMIRAL: 1, GOVERNOR: 2 },
    });
    const release = await releases.create(creator.id, input, context);
    await releases.publish(
      creator.id,
      release.id,
      { ...input, expectedVersion: release.version },
      context,
    );
    const orders = await database
      .select({ id: giftOrders.id, biliUid: giftOrders.biliUid })
      .from(giftOrders);
    expect(orders).toHaveLength(total);
    expect(await database.select({ value: count() }).from(giftOrderItems)).toEqual([
      { value: total * input.packages.length },
    ]);

    const encryption = new EncryptionKeyRing({
      activeVersion: 1,
      keyRing: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    const address = {
      recipientName: '测试用户',
      phone: '13800138000',
      countryRegion: '中国大陆',
      province: '上海市',
      city: '上海市',
      district: '浦东新区',
      detailedAddress: '测试路 1 号',
      postalCode: '',
      userNote: '',
    };
    // This scenario begins with frozen claim facts; normal claiming is exercised separately.
    // Each claimant owns its actual UID, and the original address is no longer required.
    await database.transaction(async (transaction) => {
      for (const batch of databaseWriteBatches(orders)) {
        await transaction.insert(users).values(
          batch.map((order) => ({
            username: `member_${order.biliUid}`,
            name: 'Member',
            bilibiliUid: order.biliUid,
          })),
        );
        await transaction.insert(giftOrderAddresses).values(
          batch.map((order) => {
            const id = randomUUID();
            return {
              id,
              giftOrderId: order.id,
              ...encryption.encrypt(address, `gift-order-address:${id}`),
            };
          }),
        );
      }
      await transaction.execute(sql`
        update gift_orders as orders
        set status = 'SUBMITTED', submitted_at = ${clock.now().toISOString()}::timestamptz,
            user_id = claimant.id, version = orders.version + 1
        from users as claimant
        where orders.gift_release_id = ${release.id} and claimant.bilibili_uid = orders.bili_uid
      `);
    });
    await releases.close(creator.id, release.id, context);
    const exported = await new GiftFulfillmentExportService(
      fixture.database,
      encryption,
      clock,
    ).exportRelease(creator, release.id, context);
    expect(exported.rowCount).toBe(total);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      exported.content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.worksheets[0]?.rowCount).toBe(total + 1);
    expect(
      await database
        .select({ value: count() })
        .from(giftOrders)
        .where(eq(giftOrders.status, 'SUBMITTED')),
    ).toEqual([{ value: total }]);
  }, 120_000);
});
