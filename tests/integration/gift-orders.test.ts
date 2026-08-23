import { resolve } from 'node:path';

import { and, count, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { SystemClock } from '../../src/server/infrastructure/clock/clock.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';
import {
  bilibiliBindings,
  bindingChallenges,
  creators,
  auditLogs,
  giftOrderItems,
  giftOrderStatusHistory,
  giftOrders,
  shipments,
  snapshotMembers,
  snapshotRuns,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema/index.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import { AddressService } from '../../src/server/modules/addresses/address-service.js';
import type { AppAuth } from '../../src/server/modules/auth/auth.js';
import { TrackingRefreshService } from '../../src/server/modules/fulfillment/tracking-refresh-service.js';
import { GiftOrderService } from '../../src/server/modules/gifts/order-service.js';
import {
  GiftReleaseService,
  type ReleaseDraftInput,
} from '../../src/server/modules/gifts/release-service.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

const addressPayload = {
  city: '上海市',
  countryRegion: '中国大陆',
  detailedAddress: '测试路 1 号',
  district: '浦东新区',
  phone: '13800138000',
  postalCode: '200000',
  province: '上海市',
  recipientName: '原收件人',
  userNote: '',
};

function requestContext(actorUserId: string, requestId: string) {
  return { actorUserId, ipAddress: '127.0.0.1', requestId };
}

function releaseDraft(eligibilityMonth: string): ReleaseDraftInput {
  const now = Date.now();
  return {
    claimDeadlineAt: new Date(now + 30 * 86_400_000).toISOString(),
    claimStartAt: new Date(now - 86_400_000).toISOString(),
    description: `${eligibilityMonth} 舰长纪念礼物`,
    eligibilityMonth,
    formFields: [
      {
        key: 'color',
        label: '颜色',
        options: ['蓝色', '粉色'],
        required: true,
        type: 'SELECT',
      },
    ],
    fulfillmentMode: 'CUMULATIVE',
    packages: [
      {
        description: '舰长基础礼物',
        items: [{ description: '', name: '舰长徽章', quantity: 1 }],
        name: '舰长礼物',
      },
      {
        description: '提督追加礼物',
        items: [{ description: '', name: '提督纪念卡', quantity: 1 }],
        name: '提督礼物',
      },
      {
        description: '总督追加礼物',
        items: [{ description: '', name: '总督纪念盒', quantity: 1 }],
        name: '总督礼物',
      },
    ],
    publicVisible: false,
    tierPackageIndexes: { ADMIRAL: 1, CAPTAIN: 0, GOVERNOR: 2 },
    title: `${eligibilityMonth.slice(0, 7)} 舰长礼物`,
  };
}

integration('gift order lifecycle', () => {
  let admin: ReturnType<typeof postgres>;
  let database: DatabaseService;
  let databaseName: string;
  let creatorId: string;
  let otherCreatorId: string;
  let creatorUserId: string;
  let userOneId: string;
  let userTwoId: string;
  let verificationRoomId: string;
  let releaseService: GiftReleaseService;
  let addressService: AddressService;
  let encryption: EncryptionKeyRing;
  let orderService: GiftOrderService;

  beforeAll(async () => {
    const adminUrl = new URL(testDatabaseUrl!);
    adminUrl.pathname = '/postgres';
    admin = postgres(adminUrl.toString(), { max: 1 });
    databaseName = `club_gifts_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await admin.unsafe(`create database "${databaseName}"`);
    const databaseUrl = new URL(testDatabaseUrl!);
    databaseUrl.pathname = `/${databaseName}`;
    database = createDatabase(databaseUrl.toString());
    await migrateDatabase(database, resolve('migrations'));

    const accounts = await database.orm
      .insert(users)
      .values([
        { email: 'creator-one@example.com', name: 'Creator One', role: 'CREATOR' },
        { email: 'creator-two@example.com', name: 'Creator Two', role: 'CREATOR' },
        { email: 'recipient-one@example.com', name: 'Recipient One', role: 'USER' },
        { email: 'recipient-two@example.com', name: 'Recipient Two', role: 'USER' },
      ])
      .returning({ email: users.email, id: users.id });
    const accountId = (email: string) => {
      const account = accounts.find((candidate) => candidate.email === email);
      if (!account) throw new Error(`Missing test account ${email}.`);
      return account.id;
    };
    creatorUserId = accountId('creator-one@example.com');
    userOneId = accountId('recipient-one@example.com');
    userTwoId = accountId('recipient-two@example.com');
    const creatorRows = await database.orm
      .insert(creators)
      .values([
        {
          bilibiliUid: '90001',
          displayName: 'Creator One',
          roomId: '80001',
          userId: creatorUserId,
        },
        {
          bilibiliUid: '90002',
          displayName: 'Creator Two',
          roomId: '80002',
          userId: accountId('creator-two@example.com'),
        },
      ])
      .returning({ displayName: creators.displayName, id: creators.id });
    creatorId = creatorRows.find((row) => row.displayName === 'Creator One')!.id;
    otherCreatorId = creatorRows.find((row) => row.displayName === 'Creator Two')!.id;
    const [room] = await database.orm
      .insert(verificationRooms)
      .values({
        biliRoomId: '60001',
        displayName: 'Verification Room',
      })
      .returning({ id: verificationRooms.id });
    verificationRoomId = room!.id;

    encryption = new EncryptionKeyRing({
      addressEncryptionActiveKeyVersion: 1,
      addressEncryptionKeyRing: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    addressService = new AddressService(database, encryption);
    releaseService = new GiftReleaseService(database);
    orderService = new GiftOrderService(
      database,
      encryption,
      addressService,
      null,
      new SystemClock(),
    );
  });

  afterAll(async () => {
    if (database) await database.close();
    if (admin) {
      await admin`
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = ${databaseName} and pid <> pg_backend_pid()
      `;
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end({ timeout: 5 });
    }
  });

  async function finalizeSnapshot(
    periodStart: string,
    members: readonly {
      readonly biliUid: string;
      readonly tier: 'CAPTAIN' | 'ADMIRAL' | 'GOVERNOR';
    }[],
  ): Promise<string> {
    const [run] = await database.orm
      .insert(snapshotRuns)
      .values({
        creatorBilibiliUid: '90001',
        creatorId,
        creatorRoomId: '80001',
        cutoffTimezone: 'Asia/Shanghai',
        onTimeWindowEndAt: new Date(`${periodStart}T16:10:00.000Z`),
        periodStart,
        scheduledCutoffAt: new Date(`${periodStart}T15:59:00.000Z`),
      })
      .returning({ id: snapshotRuns.id });
    if (members.length > 0) {
      await database.orm.insert(snapshotMembers).values(
        members.map((member, index) => ({
          biliUid: member.biliUid,
          displayNameAtSnapshot: `Member ${member.biliUid}`,
          rawTier: member.tier === 'GOVERNOR' ? '1' : member.tier === 'ADMIRAL' ? '2' : '3',
          snapshotRunId: run!.id,
          sourcePosition: index + 1,
          tier: member.tier,
        })),
      );
    }
    await database.orm
      .update(snapshotRuns)
      .set({ finalizedAt: new Date(), status: 'FINALIZED', updatedAt: new Date() })
      .where(eq(snapshotRuns.id, run!.id));
    return run!.id;
  }

  async function bind(userId: string, biliUid: string, suffix: string): Promise<string> {
    const [challenge] = await database.orm
      .insert(bindingChallenges)
      .values({
        codeDigest: suffix.padEnd(64, 'a').slice(0, 64),
        consumedAt: new Date(),
        consumedEventId: `event-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
        status: 'CONSUMED',
        userId,
        verificationRoomId,
      })
      .returning({ id: bindingChallenges.id });
    const [binding] = await database.orm
      .insert(bilibiliBindings)
      .values({
        biliDisplayName: `Bilibili ${biliUid}`,
        biliUid,
        challengeId: challenge!.id,
        userId,
      })
      .returning({ id: bilibiliBindings.id });
    return binding!.id;
  }

  it('reconciles both event orders, keeps UID ownership until claim, and freezes fulfillment', async () => {
    const before = await database.orm.select({ value: count() }).from(giftOrders);
    const noGiftRun = await finalizeSnapshot('2026-05-01', [{ biliUid: '50001', tier: 'CAPTAIN' }]);
    expect(await releaseService.eligibility.reconcileSnapshot(noGiftRun, database.orm)).toBe(0);
    expect((await database.orm.select({ value: count() }).from(giftOrders))[0]?.value).toBe(
      before[0]?.value,
    );

    const firstBindingId = await bind(userOneId, '11001', 'one');
    await finalizeSnapshot('2026-06-01', [
      { biliUid: '11001', tier: 'CAPTAIN' },
      { biliUid: '11002', tier: 'GOVERNOR' },
    ]);
    const june = await releaseService.create(
      creatorId,
      releaseDraft('2026-06-01'),
      requestContext(creatorUserId, 'create-june'),
    );
    await Promise.all([
      releaseService.publish(
        creatorId,
        june.id,
        { ...releaseDraft('2026-06-01'), expectedVersion: june.version },
        requestContext(creatorUserId, 'publish-june'),
      ),
      releaseService.publish(
        creatorId,
        june.id,
        { ...releaseDraft('2026-06-01'), expectedVersion: june.version },
        requestContext(creatorUserId, 'publish-june-again'),
      ),
    ]);
    const juneOrders = await database.orm
      .select()
      .from(giftOrders)
      .where(eq(giftOrders.giftReleaseId, june.id));
    expect(juneOrders).toHaveLength(2);
    const captainOrder = juneOrders.find((order) => order.biliUid === '11001')!;
    expect(captainOrder.userId).toBeNull();
    expect(await orderService.listForUser(userOneId)).toHaveLength(1);

    await database.orm
      .update(bilibiliBindings)
      .set({ unboundAt: new Date(), updatedAt: new Date() })
      .where(eq(bilibiliBindings.id, firstBindingId));
    expect(await orderService.listForUser(userOneId)).toHaveLength(0);
    await bind(userTwoId, '11001', 'two');
    expect(await orderService.listForUser(userTwoId)).toHaveLength(1);

    const address = await addressService.create(
      userTwoId,
      { isDefault: true, label: '家', payload: addressPayload },
      requestContext(userTwoId, 'create-address'),
    );
    const visible = await orderService.getForUser(userTwoId, captainOrder.id);
    await orderService.submit(
      userTwoId,
      captainOrder.id,
      {
        addressId: address.id,
        expectedVersion: visible.version,
        options: { color: '蓝色' },
      },
      requestContext(userTwoId, 'submit-order'),
    );
    const [claimed] = await database.orm
      .select({ userId: giftOrders.userId })
      .from(giftOrders)
      .where(eq(giftOrders.id, captainOrder.id));
    expect(claimed?.userId).toBe(userTwoId);

    await addressService.update(
      userTwoId,
      address.id,
      { payload: { ...addressPayload, recipientName: '后来修改的名字' } },
      requestContext(userTwoId, 'update-address'),
    );
    const creatorView = await orderService.getForCreator(
      creatorId,
      captainOrder.id,
      requestContext(creatorUserId, 'read-fulfillment'),
    );
    expect(creatorView.deliveryAddress?.recipientName).toBe('原收件人');
    expect(creatorView.optionValues).toEqual([{ key: 'color', label: '颜色', value: '蓝色' }]);
    await addressService.delete(
      userTwoId,
      address.id,
      requestContext(userTwoId, 'delete-source-address'),
    );
    expect(await addressService.list(userTwoId)).toEqual([]);
    expect(
      (
        await orderService.getForCreator(
          creatorId,
          captainOrder.id,
          requestContext(creatorUserId, 'read-frozen-address-after-delete'),
        )
      ).deliveryAddress?.recipientName,
    ).toBe('原收件人');
    await expect(
      orderService.getForCreator(
        otherCreatorId,
        captainOrder.id,
        requestContext(creatorUserId, 'cross-creator-read'),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_ORDER_NOT_FOUND' });
    await expect(
      orderService.exportFulfillment(
        { displayName: 'Creator Two', id: otherCreatorId, timezone: 'Asia/Shanghai' },
        june.id,
        requestContext(creatorUserId, 'cross-creator-export'),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_RELEASE_NOT_FOUND' });
    const exported = await orderService.exportFulfillment(
      { displayName: 'Creator One', id: creatorId, timezone: 'Asia/Shanghai' },
      june.id,
      requestContext(creatorUserId, 'export-fulfillment'),
    );
    expect(exported.rowCount).toBe(1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      exported.content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const fulfillmentSheet = workbook.getWorksheet('待发货清单');
    expect(fulfillmentSheet?.getCell('B2').value).toBe('原收件人');
    expect(fulfillmentSheet?.getCell('O2').value).toContain('舰长徽章 × 1');
    expect(fulfillmentSheet?.getCell('R2').value).toBe('蓝色');
    expect(
      (
        await database.orm
          .select({ status: giftOrders.status })
          .from(giftOrders)
          .where(eq(giftOrders.id, captainOrder.id))
      )[0]?.status,
    ).toBe('SUBMITTED');
    expect(
      (
        await database.orm
          .select({ value: count() })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'gift-release.fulfillment-exported'),
              eq(auditLogs.targetId, june.id),
            ),
          )
      )[0]?.value,
    ).toBe(1);
    const storage = await createTemporaryStorage();
    const routeApp = await buildApp({
      auth: {
        api: {
          getSession: () =>
            Promise.resolve({
              session: {
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
                id: 'route-session',
                ipAddress: null,
                token: 'route-token',
                updatedAt: new Date(),
                userAgent: null,
                userId: creatorUserId,
              },
              user: {
                createdAt: new Date(),
                email: 'creator-one@example.com',
                emailVerified: true,
                id: creatorUserId,
                image: null,
                name: 'Creator One',
                role: 'CREATOR',
                updatedAt: new Date(),
              },
            }),
        },
        handler: () => Promise.resolve(new Response(null, { status: 404 })),
      } as unknown as AppAuth,
      config: createTestConfig(),
      database,
      startBackground: false,
      storage: storage.driver,
    });
    try {
      const download = await routeApp.inject({
        headers: { origin: 'http://localhost:3000' },
        method: 'POST',
        payload: { releaseId: june.id },
        url: '/api/v1/creator/orders/fulfillment-export',
      });
      expect(download.statusCode, download.body).toBe(200);
      expect(download.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(download.headers['content-disposition']).toContain(
        "filename*=UTF-8''Creator%20One-2026-06-",
      );
      expect(download.headers['cache-control']).toBe('no-store');
      expect(download.headers['x-export-row-count']).toBe('1');
      expect(download.rawPayload.subarray(0, 2).toString()).toBe('PK');
    } finally {
      await routeApp.close();
      await storage.cleanup();
    }
    await expect(
      orderService.complete(
        creatorId,
        captainOrder.id,
        requestContext(creatorUserId, 'invalid-complete'),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_ORDER_TRANSITION_INVALID' });

    const [submitted] = await database.orm
      .select({ version: giftOrders.version })
      .from(giftOrders)
      .where(eq(giftOrders.id, captainOrder.id));
    await expect(
      database.orm
        .update(giftOrders)
        .set({
          completedAt: new Date(),
          status: 'COMPLETED',
          version: submitted!.version + 1,
        })
        .where(eq(giftOrders.id, captainOrder.id)),
    ).rejects.toThrow();
    const shipped = await orderService.ship(
      creatorId,
      captainOrder.id,
      {
        carrierCode: 'ZTO',
        carrierName: '中通快递',
        trackingNumber: 'ZT123456789',
      },
      requestContext(creatorUserId, 'ship-order'),
    );
    expect(shipped.status).toBe('SHIPPED');
    expect(shipped.shipments).toHaveLength(1);
    expect(
      (
        await database.orm
          .select({
            fromStatus: giftOrderStatusHistory.fromStatus,
            toStatus: giftOrderStatusHistory.toStatus,
          })
          .from(giftOrderStatusHistory)
          .where(eq(giftOrderStatusHistory.giftOrderId, captainOrder.id))
      ).map((transition) => `${transition.fromStatus}->${transition.toStatus}`),
    ).toContain('SUBMITTED->SHIPPED');
    await expect(
      orderService.exportFulfillment(
        { displayName: 'Creator One', id: creatorId, timezone: 'Asia/Shanghai' },
        june.id,
        requestContext(creatorUserId, 'empty-fulfillment-export'),
      ),
    ).rejects.toMatchObject({ code: 'FULFILLMENT_EXPORT_EMPTY' });
    await expect(
      orderService.ship(
        creatorId,
        captainOrder.id,
        {
          carrierCode: 'ZTO',
          carrierName: '中通快递',
          trackingNumber: 'ZT987654321',
        },
        requestContext(creatorUserId, 'ship-order-again'),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_ORDER_NOT_SHIPPABLE' });
    await database.orm
      .update(shipments)
      .set({ nextTrackingRefreshAt: new Date(0) })
      .where(eq(shipments.giftOrderId, captainOrder.id));
    const failingTrackingService = new TrackingRefreshService(database, {
      query: () => Promise.reject(new Error('simulated provider outage')),
    });
    await expect(failingTrackingService.refreshDue()).rejects.toMatchObject({
      code: 'TRACKING_REFRESH_FAILED',
    });
    const [failedShipment] = await database.orm
      .select({
        lastTrackingError: shipments.lastTrackingError,
        trackingFailureCount: shipments.trackingFailureCount,
      })
      .from(shipments)
      .where(eq(shipments.giftOrderId, captainOrder.id));
    expect(failedShipment).toMatchObject({
      lastTrackingError: 'simulated provider outage',
      trackingFailureCount: 1,
    });
    await orderService.complete(
      creatorId,
      captainOrder.id,
      requestContext(creatorUserId, 'complete-order'),
    );
    expect((await orderService.getForUser(userTwoId, captainOrder.id)).status).toBe('COMPLETED');

    const july = await releaseService.create(
      creatorId,
      releaseDraft('2026-07-01'),
      requestContext(creatorUserId, 'create-july'),
    );
    await releaseService.publish(
      creatorId,
      july.id,
      { ...releaseDraft('2026-07-01'), expectedVersion: july.version },
      requestContext(creatorUserId, 'publish-july'),
    );
    expect(
      (
        await database.orm
          .select({ value: count() })
          .from(giftOrders)
          .where(eq(giftOrders.giftReleaseId, july.id))
      )[0]?.value,
    ).toBe(0);
    const julyRun = await finalizeSnapshot('2026-07-01', [{ biliUid: '12001', tier: 'ADMIRAL' }]);
    expect(await releaseService.eligibility.reconcileSnapshot(julyRun, database.orm)).toBe(1);
    expect(await releaseService.eligibility.reconcileSnapshot(julyRun, database.orm)).toBe(0);
    const [julyOrder] = await database.orm
      .select({ id: giftOrders.id })
      .from(giftOrders)
      .where(eq(giftOrders.giftReleaseId, july.id));
    const julyItems = await database.orm
      .select()
      .from(giftOrderItems)
      .where(eq(giftOrderItems.giftOrderId, julyOrder!.id));
    expect(julyItems).toHaveLength(2);
    await expect(
      releaseService.create(
        creatorId,
        releaseDraft('2026-07-01'),
        requestContext(creatorUserId, 'duplicate-july'),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_RELEASE_MONTH_CONFLICT' });
  });

  it('atomically publishes current unsaved content with optimistic locking', async () => {
    const initial = releaseDraft('2026-08-01');
    const draft = await releaseService.create(
      creatorId,
      { ...initial, title: '保存过的旧标题' },
      requestContext(creatorUserId, 'create-august'),
    );
    const published = await releaseService.publish(
      creatorId,
      draft.id,
      {
        ...initial,
        description: '直接发布时输入的新说明',
        expectedVersion: draft.version,
        title: '直接发布时输入的新标题',
      },
      requestContext(creatorUserId, 'publish-august-current-content'),
    );

    expect(published).toMatchObject({
      description: '直接发布时输入的新说明',
      status: 'PUBLISHED',
      title: '直接发布时输入的新标题',
      version: draft.version + 1,
    });
  });
});
