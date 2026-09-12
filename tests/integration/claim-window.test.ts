import { and, eq, sql } from 'drizzle-orm';
import {
  describe as integration,
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';

import { giftOrders, users } from '../../src/server/infrastructure/db/schema/index.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import { AddressService } from '../../src/server/modules/addresses/address-service.js';
import { GiftClaimService } from '../../src/server/modules/gifts/claim-service.js';
import { GiftOrderQueryService } from '../../src/server/modules/gifts/order-query-service.js';

import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { insertFinalizedSnapshot } from '../helpers/snapshot-fixture.js';

integration('claim windows', () => {
  let fixture: IntegrationDatabase;
  let creatorId: string;
  let actorUserId: string;
  let recipientId: string;
  let addressId: string;
  let releases: GiftReleaseService;
  let queries: GiftOrderQueryService;
  let claims: GiftClaimService;

  let addresses: AddressService;
  let encryption: EncryptionKeyRing;
  let current = new Date('2026-09-01T00:00:00Z');
  const clock = { now: () => current };
  const context = () => ({ actorUserId, ipAddress: '127.0.0.1', requestId: 'claim-window' });

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('claim_window');
  });
  beforeEach(async () => {
    await fixture.database.orm.execute(sql`truncate users cascade`);
    current = new Date('2026-09-01T00:00:00Z');
    const accounts = await fixture.database.orm
      .insert(users)
      .values([
        { username: 'claim_creator', bilibiliUid: '910001', name: 'Creator', role: 'CREATOR' },
        { username: 'claim_recipient', bilibiliUid: '100001', name: 'Recipient', role: 'USER' },
      ])
      .returning();
    actorUserId = accounts[0]!.id;
    recipientId = accounts[1]!.id;
    creatorId = (
      await insertTestCreator(fixture.database, {
        userId: actorUserId,
        bilibiliUid: '910001',
        roomId: '810001',
        displayName: 'Creator',
      })
    ).id;
    encryption = new EncryptionKeyRing({
      activeVersion: 1,
      keyRing: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    addresses = new AddressService(fixture.database, encryption);
    addressId = (
      await addresses.create(
        recipientId,
        {
          isDefault: true,
          label: '家',
          payload: {
            recipientName: '测试用户',
            phone: '13800138000',
            countryRegion: '中国大陆',
            province: '上海市',
            city: '上海市',
            district: '浦东新区',
            detailedAddress: '测试路 1 号',
            postalCode: '',
            userNote: '',
          },
        },
        { ...context(), actorUserId: recipientId },
      )
    ).id;
    releases = new GiftReleaseService(fixture.database, clock);
    queries = new GiftOrderQueryService(fixture.database, encryption, clock);
    claims = new GiftClaimService(fixture.database, encryption, addresses, clock);
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await fixture?.cleanup();
  });

  async function publish(
    periodStart: string,
    overrides: Parameters<typeof createReleaseDraft>[1] = {},
  ) {
    await insertFinalizedSnapshot(fixture.database, {
      creatorId,
      periodStart,
      members: [{ biliUid: '100001', tier: 'GOVERNOR' }],
    });
    const draft = createReleaseDraft(periodStart, overrides);
    const release = await releases.create(creatorId, draft, context());
    await releases.publish(
      creatorId,
      release.id,
      { ...draft, expectedVersion: release.version },
      context(),
    );
    const [order] = await fixture.database.orm
      .select()
      .from(giftOrders)
      .where(and(eq(giftOrders.giftReleaseId, release.id), eq(giftOrders.biliUid, '100001')));
    return { order: order!, releaseId: release.id };
  }

  const submit = (id: string) =>
    claims.submit(
      recipientId,
      id,
      { addressId, expectedVersion: 1, options: {} },
      { ...context(), actorUserId: recipientId },
    );

  it('derives upcoming, claimable and expired immediately without changing the stored order', async () => {
    const { order } = await publish('2026-01-01', {
      claimStartAt: '2026-09-02T00:00:00Z',
      claimDeadlineAt: '2026-09-03T00:00:00Z',
    });
    expect((await queries.getForUser(recipientId, order.id)).status).toBe('UPCOMING');
    await expect(submit(order.id)).rejects.toMatchObject({
      code: 'GIFT_ORDER_CLAIM_WINDOW_CLOSED',
    });
    current = new Date('2026-09-02T00:00:00Z');
    expect(
      (await queries.listForUser(recipientId, { filter: 'CLAIMABLE', limit: 20 })).items.map(
        (it) => it.id,
      ),
    ).toContain(order.id);
    current = new Date('2026-09-03T00:00:00Z');
    expect(await queries.getForUser(recipientId, order.id)).toMatchObject({
      status: 'EXPIRED',
      expiredAt: current,
      expiryReason: 'DEADLINE',
      version: 1,
    });
    expect(
      (await queries.listForUser(recipientId, { filter: 'CLAIMABLE', limit: 20 })).items,
    ).toHaveLength(0);
    expect((await queries.overviewForCreator(creatorId)).counts.expired).toBe(1);
    await expect(submit(order.id)).rejects.toMatchObject({
      code: 'GIFT_ORDER_CLAIM_WINDOW_CLOSED',
    });
    expect(
      await fixture.database.orm
        .select({ status: giftOrders.status, version: giftOrders.version })
        .from(giftOrders)
        .where(eq(giftOrders.id, order.id)),
    ).toEqual([{ status: 'UNCLAIMED', version: 1 }]);
  });

  it('counts and finds urgent gifts beyond the most recent twelve orders', async () => {
    const urgent = await publish('2026-02-01', { claimDeadlineAt: '2026-09-02T00:00:00Z' });
    for (let index = 0; index < 13; index += 1) {
      const year = 2027 + Math.floor(index / 12);
      const month = String((index % 12) + 1).padStart(2, '0');
      await publish(`${year}-${month}-01`);
    }
    expect(
      (await queries.listForUser(recipientId, { filter: 'ALL', limit: 12 })).items.some(
        (row) => row.id === urgent.order.id,
      ),
    ).toBe(false);
    expect(await queries.overviewForUser(recipientId)).toMatchObject({
      counts: { claimable: 14 },
      urgent: { id: urgent.order.id },
    });
  });

  it('closes remaining claims without mutating their stored order state', async () => {
    const { order, releaseId } = await publish('2026-03-01');
    await releases.close(creatorId, releaseId, context());
    expect(await queries.getForUser(recipientId, order.id)).toMatchObject({
      status: 'EXPIRED',
      expiryReason: 'RELEASE_CLOSED',
    });
    expect(await fixture.database.orm.select().from(giftOrders)).toEqual([order]);
    await expect(submit(order.id)).rejects.toMatchObject({
      code: 'GIFT_ORDER_CLAIM_WINDOW_CLOSED',
    });
  });

  it('allows an in-flight claim to finish before closure takes effect', async () => {
    const { order, releaseId } = await publish('2026-03-01');
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = addresses.getPlaintext.bind(addresses);
    vi.spyOn(addresses, 'getPlaintext').mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return original(...args);
    });
    const claiming = submit(order.id);
    await entered.promise;
    const closing = releases.close(creatorId, releaseId, context());
    try {
      await vi.waitFor(async () => {
        const [waiting] = await fixture.database.orm.execute<{ value: number }>(sql`
          select count(*)::int as value from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `);
        expect(waiting?.value).toBeGreaterThan(0);
      });
    } finally {
      release.resolve();
      await Promise.all([claiming, closing]);
    }
    expect(await queries.getForUser(recipientId, order.id)).toMatchObject({
      status: 'SUBMITTED',
      expiryReason: null,
    });
  });
});
