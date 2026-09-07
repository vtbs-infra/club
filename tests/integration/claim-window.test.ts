import { randomUUID } from 'node:crypto';

import ExcelJS from 'exceljs';
import { and, count, eq, sql } from 'drizzle-orm';
import { describe as integration, afterAll, beforeAll, expect, it, vi } from 'vitest';

import {
  giftOrderItems,
  giftOrderAddresses,
  giftOrderOptionValues,
  giftOrderStatusHistory,
  giftOrders,
  users,
} from '../../src/server/infrastructure/db/schema/index.js';
import { databaseWriteBatches } from '../../src/server/infrastructure/db/write-batches.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { AddressService } from '../../src/server/modules/addresses/address-service.js';
import { AuditService } from '../../src/server/modules/audit/audit-service.js';
import { FakeGuardRosterSource } from '../helpers/fake-guard-roster-source.js';
import { GiftClaimService } from '../../src/server/modules/gifts/claim-service.js';
import { GiftFulfillmentExportService } from '../../src/server/modules/gifts/fulfillment-export-service.js';
import { GiftOrderQueryService } from '../../src/server/modules/gifts/order-query-service.js';

import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { SnapshotService } from '../../src/server/modules/snapshots/snapshot-service.js';
import { insertTestBilibiliBinding, insertTestCreator } from '../helpers/creator-fixture.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { insertReadySnapshot } from '../helpers/snapshot-fixture.js';

integration('claim windows and capacity', () => {
  let fixture: IntegrationDatabase;
  let storage: TemporaryStorage;
  let creatorId: string;
  let actorUserId: string;
  let recipientId: string;
  let addressId: string;
  let releases: GiftReleaseService;
  let snapshots: SnapshotService;
  let queries: GiftOrderQueryService;
  let claims: GiftClaimService;
  let exporter: GiftFulfillmentExportService;

  let addresses: AddressService;
  let encryption: EncryptionKeyRing;
  let current = new Date('2026-09-01T00:00:00Z');
  const clock = { now: () => current };
  const context = () => ({ actorUserId, ipAddress: '127.0.0.1', requestId: 'claim-window' });

  beforeAll(async () => {
    fixture = await createIntegrationDatabase('claim_window');
    storage = await createTemporaryStorage();
    const accounts = await fixture.database.orm
      .insert(users)
      .values([
        { email: 'claim-creator@example.test', name: 'Creator', role: 'CREATOR' },
        { email: 'claim-recipient@example.test', name: 'Recipient', role: 'USER' },
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
    await insertTestBilibiliBinding(fixture.database, {
      userId: recipientId,
      biliUid: '100001',
      biliDisplayName: 'Recipient',
    });
    encryption = new EncryptionKeyRing({
      addressEncryptionActiveKeyVersion: 1,
      addressEncryptionKeyRing: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
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
    snapshots = new SnapshotService(
      fixture.database,
      storage.driver,
      new FakeGuardRosterSource(),
      clock,
      releases.eligibility,
    );
    queries = new GiftOrderQueryService(fixture.database, encryption, clock);
    claims = new GiftClaimService(fixture.database, encryption, addresses, clock);
    exporter = new GiftFulfillmentExportService(fixture.database, encryption, clock);
  });

  afterAll(async () => {
    await storage?.cleanup();
    await fixture?.cleanup();
  });

  async function publish(
    periodStart: string,
    overrides: Parameters<typeof createReleaseDraft>[1] = {},
    size = 1,
  ) {
    const { run } = await insertReadySnapshot(fixture.database, {
      creatorId,
      periodStart,
      members: Array.from({ length: size }, (_, index) => ({
        biliUid: String(100001 + index),
        tier: 'GOVERNOR',
      })),
    });
    await snapshots.finalizeReady(run.id);
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
      { addressId, expectedVersion: 1, options: { color: '蓝色' } },
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
    const urgent = await publish('2026-02-01', { claimDeadlineAt: '2026-09-04T00:00:00Z' });
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
      counts: { claimable: 14, expired: 1 },
      urgent: { id: urgent.order.id },
    });
  });

  it.each(['claim', 'close'] as const)(
    'gives a consistent result when %s holds the release before the competing action',
    async (first) => {
      const { order, releaseId } = await publish(first === 'claim' ? '2026-03-01' : '2026-04-01');
      let enter!: () => void;
      let resume!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const addressRead = addresses.getPlaintext.bind(addresses);
      const audit = new AuditService(fixture.database);
      const auditRecord = audit.record.bind(audit);
      const spy =
        first === 'claim'
          ? vi.spyOn(addresses, 'getPlaintext').mockImplementationOnce(async (...args) => {
              enter();
              await gate;
              return addressRead(...args);
            })
          : vi.spyOn(AuditService.prototype, 'record').mockImplementation(async function (
              this: AuditService,
              ...args
            ) {
              if (args[0].action === 'gift-release.closed' && args[0].targetId === releaseId) {
                enter();
                await gate;
              }
              return auditRecord(...args);
            });
      const close = () => releases.close(creatorId, releaseId, context());
      const leader = first === 'claim' ? submit(order.id) : close();
      await entered;
      const follower = first === 'claim' ? close() : submit(order.id);
      const results = Promise.allSettled([leader, follower]);
      try {
        await vi.waitFor(async () => {
          const [waiting] = await fixture.database.orm.execute<{ value: number }>(
            sql`select count(*)::int as value from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
          );
          expect(waiting?.value).toBeGreaterThan(0);
        });
      } finally {
        resume();
      }
      const settled = await results;
      spy.mockRestore();
      expect(settled[0]?.status).toBe('fulfilled');
      expect(settled[1]?.status).toBe(first === 'claim' ? 'fulfilled' : 'rejected');
      expect(await queries.getForUser(recipientId, order.id)).toMatchObject(
        first === 'claim'
          ? { status: 'SUBMITTED', expiryReason: null }
          : { status: 'EXPIRED', expiryReason: 'RELEASE_CLOSED' },
      );
    },
  );

  it('generates and closes a 30,000-member cumulative release without per-order expiry writes', async () => {
    const { releaseId } = await publish('2029-01-01', {}, 30_000);
    const database = fixture.database.orm;
    expect(
      await database
        .select({ value: count() })
        .from(giftOrders)
        .where(eq(giftOrders.giftReleaseId, releaseId)),
    ).toEqual([{ value: 30_000 }]);
    expect(
      await database
        .select({ value: count() })
        .from(giftOrderItems)
        .innerJoin(giftOrders, eq(giftOrders.id, giftOrderItems.giftOrderId))
        .where(eq(giftOrders.giftReleaseId, releaseId)),
    ).toEqual([{ value: 90_000 }]);
    await releases.close(creatorId, releaseId, context());
    expect(
      (await queries.listForCreator(creatorId, { status: 'EXPIRED', limit: 100 })).items,
    ).toHaveLength(100);
    expect(
      await database
        .select({ value: count() })
        .from(giftOrders)
        .where(
          and(
            eq(giftOrders.giftReleaseId, releaseId),
            eq(giftOrders.status, 'UNCLAIMED'),
            eq(giftOrders.version, 1),
          ),
        ),
    ).toEqual([{ value: 30_000 }]);
    expect(
      await database
        .select({ value: count() })
        .from(giftOrderStatusHistory)
        .innerJoin(giftOrders, eq(giftOrders.id, giftOrderStatusHistory.giftOrderId))
        .where(eq(giftOrders.giftReleaseId, releaseId)),
    ).toEqual([{ value: 0 }]);
  }, 60_000);
  it('exports all 30,000 frozen claims and their allocated packages after closure', async () => {
    const { releaseId } = await publish('2029-02-01', {}, 30_000);
    const database = fixture.database.orm;
    const records = await database
      .select({ id: giftOrders.id })
      .from(giftOrders)
      .where(eq(giftOrders.giftReleaseId, releaseId));
    const address = await addresses.getPlaintext(recipientId, addressId);
    // Seed bulk submitted facts; individual authorized claims and encryption are tested above.
    await database.transaction(async (transaction) => {
      for (const batch of databaseWriteBatches(records)) {
        await transaction.insert(giftOrderAddresses).values(
          batch.map((order) => {
            const id = randomUUID();
            return {
              id,
              giftOrderId: order.id,
              sourceAddressId: addressId,
              ...encryption.encrypt(address.payload, 'gift-order-address:' + id),
            };
          }),
        );
        await transaction.insert(giftOrderOptionValues).values(
          batch.map((order) => {
            const id = randomUUID();
            return {
              id,
              giftOrderId: order.id,
              fieldKey: 'color',
              fieldLabel: '颜色',
              ...encryption.encrypt('蓝色', 'gift-order-option:' + id),
            };
          }),
        );
      }
      await transaction
        .update(giftOrders)
        .set({ status: 'SUBMITTED', submittedAt: current, userId: recipientId, version: 2 })
        .where(eq(giftOrders.giftReleaseId, releaseId));
    });
    await releases.close(creatorId, releaseId, context());
    const exported = await exporter.exportRelease(
      { id: creatorId, displayName: 'Creator', timezone: 'Asia/Shanghai' },
      releaseId,
      context(),
    );
    expect(exported.rowCount).toBe(30_000);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      exported.content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet('待发货清单');
    expect(sheet?.rowCount).toBe(30_001);
    for (const row of [2, 30_001]) {
      expect(sheet?.getCell('B' + row).value).toBe('测试用户');
      expect(sheet?.getCell('O' + row).value).toContain('总督纪念盒 × 1');
      expect(sheet?.getCell('R' + row).value).toBe('蓝色');
    }
    expect(
      await database
        .select({ value: count() })
        .from(giftOrders)
        .where(
          and(
            eq(giftOrders.giftReleaseId, releaseId),
            eq(giftOrders.status, 'SUBMITTED'),
            eq(giftOrders.version, 2),
          ),
        ),
    ).toEqual([{ value: 30_000 }]);
  }, 90_000);
});
