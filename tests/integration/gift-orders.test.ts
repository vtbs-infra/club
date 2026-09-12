import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditLogs, giftOrders, users } from '../../src/server/infrastructure/db/schema/index.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import { AddressService } from '../../src/server/modules/addresses/address-service.js';
import { GiftClaimService } from '../../src/server/modules/gifts/claim-service.js';
import { GiftFulfillmentExportService } from '../../src/server/modules/gifts/fulfillment-export-service.js';
import { GiftFulfillmentService } from '../../src/server/modules/gifts/fulfillment-service.js';
import { GiftOrderQueryService } from '../../src/server/modules/gifts/order-query-service.js';
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { insertFinalizedSnapshot } from '../helpers/snapshot-fixture.js';

const addressPayload = {
  recipientName: '原收件人',
  phone: '13800138000',
  countryRegion: '中国大陆',
  province: '上海市',
  city: '上海市',
  district: '浦东新区',
  detailedAddress: '测试路 1 号',
  postalCode: '200000',
  userNote: '',
};
const clock = { now: () => new Date('2026-08-01T00:00:00Z') };

describe('gift ownership and fulfillment', () => {
  let fixture: IntegrationDatabase;
  let creatorId: string;
  let ownerId: string;
  let recipientId: string;
  let addresses: AddressService;
  let claims: GiftClaimService;
  let fulfillment: GiftFulfillmentService;
  let queries: GiftOrderQueryService;
  let releases: GiftReleaseService;
  let exporter: GiftFulfillmentExportService;
  const context = () => ({ actorUserId: ownerId });

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('gift_orders');
  });
  beforeEach(async () => {
    const database = fixture.database;
    await database.orm.execute(sql`truncate users cascade`);
    ownerId = randomUUID();
    recipientId = randomUUID();
    await database.orm.insert(users).values([
      { id: ownerId, username: 'creator', name: 'Creator', bilibiliUid: '910001', role: 'CREATOR' },
      { id: recipientId, username: 'recipient', name: 'Recipient', bilibiliUid: '100001' },
    ]);
    creatorId = (
      await insertTestCreator(database, {
        userId: ownerId,
        bilibiliUid: '910001',
        roomId: '810001',
        displayName: 'Creator',
      })
    ).id;
    const encryption = new EncryptionKeyRing({
      activeVersion: 1,
      keyRing: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    addresses = new AddressService(database, encryption);
    claims = new GiftClaimService(database, encryption, addresses, clock);
    queries = new GiftOrderQueryService(database, encryption, clock);
    releases = new GiftReleaseService(database, clock);
    fulfillment = new GiftFulfillmentService(database, clock);
    exporter = new GiftFulfillmentExportService(database, encryption, clock);
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });

  async function availableGift(
    members: Parameters<typeof insertFinalizedSnapshot>[1]['members'] = [
      { biliUid: '100001', tier: 'CAPTAIN' },
    ],
    overrides: Parameters<typeof createReleaseDraft>[1] = {},
  ) {
    const periodStart = '2026-07-01';
    await insertFinalizedSnapshot(fixture.database, { creatorId, periodStart, members });
    const input = createReleaseDraft(periodStart, overrides);
    const release = await releases.create(creatorId, input, context());
    await releases.publish(
      creatorId,
      release.id,
      { ...input, expectedVersion: release.version },
      context(),
    );
    const orders = await fixture.database.orm
      .select()
      .from(giftOrders)
      .where(eq(giftOrders.giftReleaseId, release.id));
    return { release, orders };
  }

  async function submit(
    order: Pick<typeof giftOrders.$inferSelect, 'id' | 'version'>,
    options = {},
  ) {
    const address = await addresses.create(
      recipientId,
      { label: '家', isDefault: true, payload: addressPayload },
      { actorUserId: recipientId },
    );
    await claims.submit(
      recipientId,
      order.id,
      { addressId: address.id, expectedVersion: order.version, options },
      { actorUserId: recipientId },
    );
    return address;
  }

  it('restricts unclaimed gifts to their UID owner and issuing creator', async () => {
    const {
      orders: [order],
      release,
    } = await availableGift();
    expect(order!.userId).toBeNull();
    expect(
      (await queries.listForUser(recipientId, { limit: 20, filter: 'ALL' })).items.map(
        (row) => row.id,
      ),
    ).toEqual([order!.id]);
    const [outsider] = await fixture.database.orm
      .insert(users)
      .values({
        username: 'outsider',
        name: 'Other creator',
        bilibiliUid: '200002',
        role: 'CREATOR',
      })
      .returning();
    const otherCreator = await insertTestCreator(fixture.database, {
      userId: outsider!.id,
      bilibiliUid: '200002',
      roomId: '820002',
      displayName: 'Other',
    });
    await expect(queries.getForUser(outsider!.id, order!.id)).rejects.toMatchObject({
      code: 'GIFT_ORDER_NOT_FOUND',
    });
    await expect(
      claims.submit(
        outsider!.id,
        order!.id,
        { addressId: randomUUID(), expectedVersion: order!.version, options: {} },
        { actorUserId: outsider!.id },
      ),
    ).rejects.toMatchObject({ code: 'BILIBILI_UID_REQUIRED' });
    await expect(
      queries.getForCreator(otherCreator.id, order!.id, { actorUserId: outsider!.id }),
    ).rejects.toMatchObject({ code: 'GIFT_ORDER_NOT_FOUND' });
    await expect(
      exporter.exportRelease(otherCreator, release.id, { actorUserId: outsider!.id }),
    ).rejects.toMatchObject({ code: 'GIFT_RELEASE_NOT_FOUND' });
  });

  it('freezes delivery facts independently of later address changes and deletion', async () => {
    const {
      orders: [order],
    } = await availableGift(undefined, {
      formFields: [
        { key: 'color', label: '颜色', type: 'SELECT', required: true, options: ['蓝色', '粉色'] },
      ],
    });
    const address = await submit(order!, { color: '蓝色' });
    await addresses.update(
      recipientId,
      address.id,
      { payload: { ...addressPayload, recipientName: '后来修改的名字' } },
      { actorUserId: recipientId },
    );
    await addresses.delete(recipientId, address.id, { actorUserId: recipientId });
    expect(await addresses.list(recipientId)).toEqual([]);
    const frozen = await queries.getForCreator(creatorId, order!.id, context());
    expect(frozen.deliveryAddress).toEqual(addressPayload);
    expect(frozen.optionValues).toEqual([{ key: 'color', label: '颜色', value: '蓝色' }]);
    const [stored] = await fixture.database.orm.select().from(giftOrders);
    expect(stored).toMatchObject({ userId: recipientId, status: 'SUBMITTED' });
  });

  it('corrects shipping with optimistic locking while preserving the original shipment time', async () => {
    const {
      orders: [order],
    } = await availableGift();
    await submit(order!);
    const initial = { carrierName: '中通快递', trackingNumber: 'ZT123456789' };
    await fulfillment.ship(creatorId, order!.id, initial, context());
    const shipped = await queries.getForCreator(creatorId, order!.id, context());
    await expect(fulfillment.ship(creatorId, order!.id, initial, context())).rejects.toMatchObject({
      code: 'GIFT_ORDER_NOT_SHIPPABLE',
    });
    const correction = { carrierName: '顺丰速运', trackingNumber: 'SF-CORRECTED' };
    await fulfillment.correctShipping(
      creatorId,
      order!.id,
      { ...correction, expectedVersion: shipped.version },
      context(),
    );
    await expect(
      fulfillment.correctShipping(
        creatorId,
        order!.id,
        { ...initial, expectedVersion: shipped.version },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_ORDER_VERSION_CONFLICT' });
    const corrected = await queries.getForCreator(creatorId, order!.id, context());
    expect(corrected).toMatchObject({
      status: 'SHIPPED',
      shippedAt: shipped.shippedAt,
      shipping: correction,
    });
    expect((await queries.getForUser(recipientId, order!.id)).shipping).toEqual(correction);
    expect(
      await fixture.database.orm
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'gift-order.shipping-corrected')),
    ).toMatchObject([
      {
        actorUserId: ownerId,
        beforeSummary: initial,
        afterSummary: correction,
      },
    ]);
  });

  it('paginates orders without duplication and searches the requested UID', async () => {
    const { orders } = await availableGift([
      { biliUid: '100001', tier: 'CAPTAIN' },
      { biliUid: '100002', tier: 'ADMIRAL' },
    ]);
    const first = await queries.listForCreator(creatorId, { limit: 1 });
    const second = await queries.listForCreator(creatorId, { limit: 1, cursor: first.nextCursor! });
    expect(new Set([...first.items, ...second.items].map((row) => row.id))).toEqual(
      new Set(orders.map((row) => row.id)),
    );
    const matches = await queries.listForCreator(creatorId, { limit: 20, search: '100002' });
    expect(matches.items.map((row) => row.biliUid)).toEqual(['100002']);
  });
});
