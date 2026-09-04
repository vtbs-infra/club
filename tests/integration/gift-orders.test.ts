import { and, count, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { databaseWriteBatches } from '../../src/server/infrastructure/db/write-batches.js';
import { SystemClock } from '../../src/server/infrastructure/clock/clock.js';
import {
  bilibiliBindings,
  bindingChallenges,
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
import { GiftReleaseService } from '../../src/server/modules/gifts/release-service.js';
import { createTestConfig } from '../helpers/test-config.js';
import { createReleaseDraft } from '../helpers/gift-release.js';
import { insertTestCreator } from '../helpers/creator-fixture.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

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

integration('gift order lifecycle', () => {
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
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
    integrationDatabase = await createIntegrationDatabase('gift_orders');
    database = integrationDatabase.database;

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
    creatorId = (
      await insertTestCreator(database, {
        bilibiliUid: '90001',
        displayName: 'Creator One',
        roomId: '80001',
        userId: creatorUserId,
      })
    ).id;
    otherCreatorId = (
      await insertTestCreator(database, {
        bilibiliUid: '90002',
        displayName: 'Creator Two',
        roomId: '80002',
        userId: accountId('creator-two@example.com'),
      })
    ).id;
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
    releaseService = new GiftReleaseService(database, new SystemClock());
    orderService = new GiftOrderService(
      database,
      encryption,
      addressService,
      null,
      new SystemClock(),
    );
  });

  afterAll(async () => {
    if (integrationDatabase) await integrationDatabase.cleanup();
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
      const rows = members.map((member, index) => ({
        biliUid: member.biliUid,
        displayNameAtSnapshot: `Member ${member.biliUid}`,
        rawTier: member.tier === 'GOVERNOR' ? '1' : member.tier === 'ADMIRAL' ? '2' : '3',
        snapshotRunId: run!.id,
        sourcePosition: index + 1,
        tier: member.tier,
      }));
      for (const batch of databaseWriteBatches(rows)) {
        await database.orm.insert(snapshotMembers).values(batch);
      }
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
      createReleaseDraft('2026-06-01'),
      requestContext(creatorUserId, 'create-june'),
    );
    await Promise.all([
      releaseService.publish(
        creatorId,
        june.id,
        { ...createReleaseDraft('2026-06-01'), expectedVersion: june.version },
        requestContext(creatorUserId, 'publish-june'),
      ),
      releaseService.publish(
        creatorId,
        june.id,
        { ...createReleaseDraft('2026-06-01'), expectedVersion: june.version },
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
    const firstCreatorPage = await orderService.listForCreator(creatorId, { limit: 1 });
    expect(firstCreatorPage.items).toHaveLength(1);
    expect(firstCreatorPage.nextCursor).not.toBeNull();
    expect(firstCreatorPage.items[0]).not.toHaveProperty('items');
    expect(firstCreatorPage.items[0]).not.toHaveProperty('shipments');
    const secondCreatorPage = await orderService.listForCreator(creatorId, {
      cursor: firstCreatorPage.nextCursor!,
      limit: 1,
    });
    expect(secondCreatorPage.items).toHaveLength(1);
    expect(secondCreatorPage.items[0]!.id).not.toBe(firstCreatorPage.items[0]!.id);
    const searchedOrders = await orderService.listForCreator(creatorId, {
      limit: 20,
      search: captainOrder.orderNumber.slice(0, 6),
    });
    expect(searchedOrders.items.some((order) => order.id === captainOrder.id)).toBe(true);
    expect(
      (await orderService.listForUser(userOneId, { filter: 'ALL', limit: 20 })).items,
    ).toHaveLength(1);

    await database.orm
      .update(bilibiliBindings)
      .set({ unboundAt: new Date(), updatedAt: new Date() })
      .where(eq(bilibiliBindings.id, firstBindingId));
    expect(
      (await orderService.listForUser(userOneId, { filter: 'ALL', limit: 20 })).items,
    ).toHaveLength(0);
    await bind(userTwoId, '11001', 'two');
    expect(
      (await orderService.listForUser(userTwoId, { filter: 'ALL', limit: 20 })).items,
    ).toHaveLength(1);

    const address = await addressService.create(
      userTwoId,
      { isDefault: true, label: '家', payload: addressPayload },
      requestContext(userTwoId, 'create-address'),
    );
    const alternateAddress = await addressService.create(
      userTwoId,
      {
        isDefault: false,
        label: '备用',
        payload: { ...addressPayload, detailedAddress: '备用路 2 号' },
      },
      requestContext(userTwoId, 'create-alternate-address'),
    );
    await addressService.update(
      userTwoId,
      address.id,
      { isDefault: false },
      requestContext(userTwoId, 'demote-default-address'),
    );
    expect((await addressService.list(userTwoId)).find((item) => item.isDefault)?.id).toBe(
      alternateAddress.id,
    );
    await addressService.delete(
      userTwoId,
      alternateAddress.id,
      requestContext(userTwoId, 'delete-alternate-address'),
    );
    await addressService.update(
      userTwoId,
      address.id,
      { isDefault: false },
      requestContext(userTwoId, 'keep-only-address-default'),
    );
    expect(await addressService.list(userTwoId)).toMatchObject([
      { id: address.id, isDefault: true },
    ]);
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
    const failingTrackingService = new TrackingRefreshService(
      database,
      {
        query: () => Promise.reject(new Error('simulated provider outage')),
      },
      new SystemClock(),
    );
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
    await database.orm
      .update(shipments)
      .set({ nextTrackingRefreshAt: new Date(0), progress: 'OUT_FOR_DELIVERY' })
      .where(eq(shipments.giftOrderId, captainOrder.id));
    await expect(
      database.orm
        .update(shipments)
        .set({ progress: 'IN_TRANSIT' })
        .where(eq(shipments.giftOrderId, captainOrder.id)),
    ).rejects.toMatchObject({ cause: { code: 'P0001' } });
    const regressingTrackingService = new TrackingRefreshService(
      database,
      {
        query: () =>
          Promise.resolve({
            events: [],
            nextRefreshAt: new Date(Date.now() + 60_000),
            status: 'IN_TRANSIT',
          }),
      },
      new SystemClock(),
    );
    expect(await regressingTrackingService.refreshDue()).toBe(1);
    expect(
      (
        await database.orm
          .select({ progress: shipments.progress })
          .from(shipments)
          .where(eq(shipments.giftOrderId, captainOrder.id))
      )[0]?.progress,
    ).toBe('OUT_FOR_DELIVERY');
    await database.orm
      .update(shipments)
      .set({ nextTrackingRefreshAt: new Date(0) })
      .where(eq(shipments.giftOrderId, captainOrder.id));
    const exceptionTrackingService = new TrackingRefreshService(
      database,
      {
        query: () =>
          Promise.resolve({
            events: [
              {
                description: '包裹暂时滞留',
                id: 'exception-event',
                occurredAt: new Date(),
                status: 'EXCEPTION',
              },
            ],
            nextRefreshAt: new Date(Date.now() + 60_000),
            status: 'EXCEPTION',
          }),
      },
      new SystemClock(),
    );
    expect(await exceptionTrackingService.refreshDue()).toBe(1);
    expect(
      (
        await database.orm
          .select({
            exceptionMessage: shipments.exceptionMessage,
            progress: shipments.progress,
          })
          .from(shipments)
          .where(eq(shipments.giftOrderId, captainOrder.id))
      )[0],
    ).toMatchObject({ exceptionMessage: '包裹暂时滞留', progress: 'OUT_FOR_DELIVERY' });
    await database.orm
      .update(shipments)
      .set({ nextTrackingRefreshAt: new Date(0) })
      .where(eq(shipments.giftOrderId, captainOrder.id));
    const recoveredTrackingService = new TrackingRefreshService(
      database,
      {
        query: () =>
          Promise.resolve({
            events: [],
            nextRefreshAt: new Date(Date.now() + 60_000),
            status: 'LABEL_CREATED',
          }),
      },
      new SystemClock(),
    );
    expect(await recoveredTrackingService.refreshDue()).toBe(1);
    expect(
      (
        await database.orm
          .select({
            exceptionMessage: shipments.exceptionMessage,
            progress: shipments.progress,
          })
          .from(shipments)
          .where(eq(shipments.giftOrderId, captainOrder.id))
      )[0],
    ).toMatchObject({ exceptionMessage: '包裹暂时滞留', progress: 'OUT_FOR_DELIVERY' });
    await database.orm
      .update(shipments)
      .set({ nextTrackingRefreshAt: new Date(0) })
      .where(eq(shipments.giftOrderId, captainOrder.id));
    const deliveredAt = new Date();
    const deliveredTrackingService = new TrackingRefreshService(
      database,
      {
        query: () =>
          Promise.resolve({
            events: [
              {
                description: '包裹已签收',
                id: 'delivered-event',
                occurredAt: deliveredAt,
                status: 'DELIVERED',
              },
            ],
            nextRefreshAt: null,
            status: 'DELIVERED',
          }),
      },
      new SystemClock(),
    );
    expect(await deliveredTrackingService.refreshDue()).toBe(1);
    expect((await orderService.getForUser(userTwoId, captainOrder.id)).status).toBe('COMPLETED');
    expect(
      (
        await database.orm
          .select({ exceptionMessage: shipments.exceptionMessage })
          .from(shipments)
          .where(eq(shipments.giftOrderId, captainOrder.id))
      )[0]?.exceptionMessage,
    ).toBeNull();
    expect(await deliveredTrackingService.refreshDue()).toBe(0);
    expect(
      (
        await database.orm
          .select({ value: count() })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'gift-order.completed'),
              eq(auditLogs.targetId, captainOrder.id),
            ),
          )
      )[0]?.value,
    ).toBe(1);

    const manuallyCompletedOrder = juneOrders.find((order) => order.biliUid === '11002')!;
    await database.orm
      .update(giftOrders)
      .set({
        status: 'SUBMITTED',
        submittedAt: new Date(),
        userId: userOneId,
        version: manuallyCompletedOrder.version + 1,
      })
      .where(eq(giftOrders.id, manuallyCompletedOrder.id));
    await orderService.ship(
      creatorId,
      manuallyCompletedOrder.id,
      {
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        trackingNumber: 'SF-MANUAL-COMPLETE',
      },
      requestContext(creatorUserId, 'ship-manually-completed-order'),
    );
    await database.orm
      .update(shipments)
      .set({
        exceptionMessage: '等待人工确认',
        lastTrackingError: 'temporary provider error',
        nextTrackingRefreshAt: new Date(0),
        trackingFailureCount: 2,
      })
      .where(eq(shipments.giftOrderId, manuallyCompletedOrder.id));
    await orderService.complete(
      creatorId,
      manuallyCompletedOrder.id,
      requestContext(creatorUserId, 'manually-complete-order'),
    );
    expect(
      (
        await database.orm
          .select({
            exceptionMessage: shipments.exceptionMessage,
            lastTrackingError: shipments.lastTrackingError,
            nextTrackingRefreshAt: shipments.nextTrackingRefreshAt,
            trackingFailureCount: shipments.trackingFailureCount,
          })
          .from(shipments)
          .where(eq(shipments.giftOrderId, manuallyCompletedOrder.id))
      )[0],
    ).toMatchObject({
      exceptionMessage: null,
      lastTrackingError: null,
      nextTrackingRefreshAt: null,
      trackingFailureCount: 0,
    });
    let completedOrderQueries = 0;
    const completedOrderTrackingService = new TrackingRefreshService(
      database,
      {
        query: () => {
          completedOrderQueries += 1;
          return Promise.reject(new Error('completed orders must not be refreshed'));
        },
      },
      new SystemClock(),
    );
    expect(await completedOrderTrackingService.refreshDue()).toBe(0);
    expect(completedOrderQueries).toBe(0);

    const july = await releaseService.create(
      creatorId,
      createReleaseDraft('2026-07-01'),
      requestContext(creatorUserId, 'create-july'),
    );
    await releaseService.publish(
      creatorId,
      july.id,
      { ...createReleaseDraft('2026-07-01'), expectedVersion: july.version },
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
    const closed = await releaseService.close(
      creatorId,
      july.id,
      requestContext(creatorUserId, 'close-july'),
    );
    expect(closed.status).toBe('CLOSED');
    expect(
      (
        await database.orm
          .select({ status: giftOrders.status })
          .from(giftOrders)
          .where(eq(giftOrders.id, julyOrder!.id))
      )[0]?.status,
    ).toBe('EXPIRED');
    expect(
      (
        await database.orm
          .select({
            fromStatus: giftOrderStatusHistory.fromStatus,
            toStatus: giftOrderStatusHistory.toStatus,
          })
          .from(giftOrderStatusHistory)
          .where(eq(giftOrderStatusHistory.giftOrderId, julyOrder!.id))
      ).map((transition) => `${transition.fromStatus}->${transition.toStatus}`),
    ).toContain('CLAIMABLE->EXPIRED');
    await expect(
      releaseService.create(
        creatorId,
        createReleaseDraft('2026-07-01'),
        requestContext(creatorUserId, 'duplicate-july'),
      ),
    ).rejects.toMatchObject({ code: 'GIFT_RELEASE_MONTH_CONFLICT' });
  });

  it('creates gift orders and package snapshots beyond the PostgreSQL parameter limit', async () => {
    const eligibilityMonth = '2027-01-01';
    const expectedOrders = 7_000;
    await finalizeSnapshot(
      eligibilityMonth,
      Array.from({ length: expectedOrders }, (_, index) => ({
        biliUid: String(20_000_000 + index),
        tier: 'GOVERNOR' as const,
      })),
    );
    const draft = createReleaseDraft(eligibilityMonth);
    const release = await releaseService.create(
      creatorId,
      draft,
      requestContext(creatorUserId, 'create-large-release'),
    );

    const published = await releaseService.publish(
      creatorId,
      release.id,
      { ...draft, expectedVersion: release.version },
      requestContext(creatorUserId, 'publish-large-release'),
    );

    expect(published.status).toBe('PUBLISHED');
    const [orderCount] = await database.orm
      .select({ value: count() })
      .from(giftOrders)
      .where(eq(giftOrders.giftReleaseId, release.id));
    const [itemCount] = await database.orm
      .select({ value: count() })
      .from(giftOrderItems)
      .innerJoin(giftOrders, eq(giftOrders.id, giftOrderItems.giftOrderId))
      .where(eq(giftOrders.giftReleaseId, release.id));
    const [sampleOrder] = await database.orm
      .select({ id: giftOrders.id, orderNumber: giftOrders.orderNumber })
      .from(giftOrders)
      .where(eq(giftOrders.giftReleaseId, release.id))
      .limit(1);
    expect(orderCount?.value).toBe(expectedOrders);
    expect(itemCount?.value).toBe(expectedOrders * 3);
    if (!sampleOrder) throw new Error('Expected a generated gift order.');
    expect(sampleOrder.orderNumber).toBe(
      `G${eligibilityMonth.slice(0, 7).replace('-', '')}-${sampleOrder.id
        .replaceAll('-', '')
        .toUpperCase()}`,
    );
  });
});
