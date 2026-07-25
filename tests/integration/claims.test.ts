import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SystemClock } from '../../src/server/infrastructure/clock/clock.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  addresses,
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  claimAddresses,
  claimEntitlements,
  claimOptionValues,
  claims,
  claimStatusHistory,
  creators,
  entitlements,
  organizationMembers,
  organizations,
  snapshotMembers,
  snapshotRuns,
  shipmentItems,
  shipments,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import type { AddressPayload } from '../../src/server/modules/addresses/address-domain.js';
import { AddressService } from '../../src/server/modules/addresses/address-service.js';
import type { AuthSession } from '../../src/server/modules/auth/auth.js';
import { CampaignService } from '../../src/server/modules/campaigns/campaign-service.js';
import { ClaimService } from '../../src/server/modules/claims/claim-service.js';
import { FakeTrackingProvider } from '../../src/server/modules/fulfillment/fake-tracking-provider.js';
import { FulfillmentService } from '../../src/server/modules/fulfillment/fulfillment-service.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

const originalAddress: AddressPayload = {
  city: 'Shanghai',
  countryRegion: 'China',
  detailedAddress: 'Original encrypted street 1',
  district: 'Pudong',
  phone: '13000000000',
  postalCode: '200000',
  province: 'Shanghai',
  recipientName: 'Original Recipient',
  userNote: 'Leave at reception',
};

integration('encrypted addresses and claims', () => {
  let database: DatabaseService;
  let addressService: AddressService;
  let campaignService: CampaignService;
  let claimService: ClaimService;
  let fulfillmentService: FulfillmentService;
  let fulfillmentSession: AuthSession;
  let userId: string;
  let organizationId: string;
  let creatorId: string;
  let addressId: string;
  let periodIndex = 1;
  const config = createTestConfig({ databaseUrl: testDatabaseUrl! });
  const keyRing = new EncryptionKeyRing(config);

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    addressService = new AddressService(database, keyRing);
    campaignService = new CampaignService(database, new SystemClock());
    claimService = new ClaimService(database, keyRing);
    fulfillmentService = new FulfillmentService(
      database,
      keyRing,
      new FakeTrackingProvider(new SystemClock()),
    );
    await database.orm.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        idempotency_records,
        claim_status_history,
        claim_option_values,
        claim_addresses,
        claim_entitlements,
        claims,
        addresses,
        entitlements,
        gift_tier_rules,
        gift_package_items,
        gift_packages,
        gift_campaigns,
        snapshot_members,
        snapshot_attempt_members,
        snapshot_pages,
        snapshot_attempts,
        snapshot_runs,
        bilibili_bindings,
        binding_challenges,
        verification_rooms,
        member_creator_scopes,
        creators,
        organization_members,
        organizations,
        sessions,
        accounts,
        verifications,
        users
      CASCADE
    `);
    const [user] = await database.orm
      .insert(users)
      .values({ email: 'claim-user@example.com', name: 'Claim User' })
      .returning({ id: users.id });
    userId = user!.id;
    const [organization] = await database.orm
      .insert(organizations)
      .values({ name: 'Claim Org', slug: 'claim-org' })
      .returning({ id: organizations.id });
    organizationId = organization!.id;
    await database.orm.insert(organizationMembers).values({
      organizationId,
      role: 'OWNER',
      userId,
    });
    const [fulfillmentUser] = await database.orm
      .insert(users)
      .values({ email: 'fulfillment@example.com', name: 'Fulfillment User' })
      .returning();
    await database.orm.insert(organizationMembers).values({
      organizationId,
      role: 'FULFILLMENT',
      userId: fulfillmentUser!.id,
    });
    fulfillmentSession = {
      session: { userId: fulfillmentUser!.id },
      user: {
        email: fulfillmentUser!.email,
        id: fulfillmentUser!.id,
        name: fulfillmentUser!.name,
        platformRole: 'USER',
      },
    } as unknown as AuthSession;
    const [creator] = await database.orm
      .insert(creators)
      .values({
        bilibiliUid: 'claim-creator',
        displayName: 'Claim Creator',
        organizationId,
        roomId: 'claim-room',
        timezone: 'Asia/Shanghai',
      })
      .returning({ id: creators.id });
    creatorId = creator!.id;
    const [room] = await database.orm
      .insert(verificationRooms)
      .values({ biliOwnerUid: 'owner', biliRoomId: 'room', displayName: 'Verification' })
      .returning({ id: verificationRooms.id });
    const [challenge] = await database.orm
      .insert(bindingChallenges)
      .values({
        codeDigest: 'digest',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        status: 'CONSUMED',
        userId,
        verificationRoomId: room!.id,
      })
      .returning({ id: bindingChallenges.id });
    await database.orm.insert(bilibiliBindings).values({
      biliUid: 'claim-recipient-uid',
      challengeId: challenge!.id,
      userId,
    });
    const address = await addressService.create(
      userId,
      { isDefault: true, label: 'Home', payload: originalAddress },
      { actorUserId: userId, requestId: 'address-create' },
    );
    addressId = address.id;
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  async function createEligibleCampaign(input: {
    cumulative?: boolean;
    deadline?: Date;
    tier?: 'CAPTAIN' | 'ADMIRAL';
    title: string;
  }) {
    const month = String(periodIndex++).padStart(2, '0');
    const periodStart = `2026-${month}-01`;
    const [run] = await database.orm
      .insert(snapshotRuns)
      .values({
        creatorBilibiliUid: 'claim-creator',
        creatorId,
        creatorRoomId: 'claim-room',
        cutoffTimezone: 'Asia/Shanghai',
        finalizedAt: new Date('2026-01-31T16:00:00.000Z'),
        onTimeWindowEndAt: new Date('2026-01-31T16:00:00.000Z'),
        organizationId,
        periodStart,
        scheduledCutoffAt: new Date('2026-01-31T15:59:00.000Z'),
        status: 'FINALIZED',
      })
      .returning({ id: snapshotRuns.id });
    await database.orm.insert(snapshotMembers).values({
      biliUid: 'claim-recipient-uid',
      displayNameAtSnapshot: 'Recipient',
      rawTier: input.tier === 'ADMIRAL' ? '2' : '3',
      snapshotRunId: run!.id,
      sourcePosition: 1,
      tier: input.tier ?? 'CAPTAIN',
    });
    const campaign = await campaignService.create(
      organizationId,
      {
        claimDeadlineAt: input.deadline ?? new Date('2027-01-01T00:00:00.000Z'),
        claimFormSchema: [
          { key: 'size', label: 'Size', options: ['S', 'M', 'L'], required: true, type: 'SELECT' },
          { key: 'note', label: 'Note', required: false, type: 'LONG_TEXT' },
        ],
        claimStartAt: new Date('2026-01-01T00:00:00.000Z'),
        creatorId,
        description: 'Encrypted claim integration',
        fulfillmentMode: input.cumulative ? 'CUMULATIVE' : 'HIGHEST_ONLY',
        periodStart,
        title: input.title,
      },
      { actorUserId: userId },
    );
    await campaignService.update(
      campaign.id,
      {
        composition: {
          packages: [
            {
              description: '',
              items: [{ description: '', name: `${input.title} item`, quantity: 1 }],
              key: 'captain',
              name: `${input.title} package`,
            },
            ...(input.cumulative
              ? [
                  {
                    description: '',
                    items: [{ description: '', name: `${input.title} bonus`, quantity: 1 }],
                    key: 'admiral',
                    name: `${input.title} admiral package`,
                  },
                ]
              : []),
          ],
          tierRules: [
            { packageKey: 'captain', tier: 'CAPTAIN' },
            ...(input.cumulative ? [{ packageKey: 'admiral', tier: 'ADMIRAL' as const }] : []),
          ],
        },
      },
      { actorUserId: userId },
    );
    await campaignService.publish(campaign.id, { actorUserId: userId });
    const [entitlement] = await database.orm
      .select()
      .from(entitlements)
      .where(eq(entitlements.campaignId, campaign.id));
    return { campaignId: campaign.id, entitlementId: entitlement!.id, runId: run!.id };
  }

  it('stores only encrypted address fields and provides audited CRUD', async () => {
    const [stored] = await database.orm.select().from(addresses).where(eq(addresses.id, addressId));
    expect(stored!.ciphertext).not.toContain(originalAddress.recipientName);
    expect(stored!.ciphertext).not.toContain(originalAddress.phone);
    expect((await addressService.list(userId, { actorUserId: userId }))[0]!.payload).toEqual(
      originalAddress,
    );
    await addressService.update(
      userId,
      addressId,
      { label: 'Primary home' },
      { actorUserId: userId },
    );
    const [audit] = await database.orm
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'address.read'), eq(auditLogs.actorUserId, userId)));
    expect(audit).toBeDefined();
  });

  it('collapses concurrent idempotent submissions into one stable claim', async () => {
    const campaign = await createEligibleCampaign({ title: 'Concurrent gift' });
    const input = { addressId, optionValues: { note: 'Blue', size: 'M' } };
    const [first, second] = await Promise.all([
      claimService.submit(userId, campaign.campaignId, input, 'same-key-concurrent', {
        actorUserId: userId,
      }),
      claimService.submit(userId, campaign.campaignId, input, 'same-key-concurrent', {
        actorUserId: userId,
      }),
    ]);
    expect(second).toEqual(first);
    const [total] = await database.orm
      .select({ value: count() })
      .from(claims)
      .where(eq(claims.campaignId, campaign.campaignId));
    expect(total!.value).toBe(1);
    await expect(
      claimService.submit(
        userId,
        campaign.campaignId,
        { addressId, optionValues: { size: 'S' } },
        'same-key-concurrent',
        { actorUserId: userId },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('creates independent snapshots, blocks cross-UID links, and freezes processing claims', async () => {
    const campaign = await createEligibleCampaign({ title: 'Frozen gift' });
    const claim = await claimService.submit(
      userId,
      campaign.campaignId,
      { addressId, optionValues: { size: 'L' } },
      'frozen-claim-key',
      { actorUserId: userId },
    );
    await addressService.update(
      userId,
      addressId,
      { payload: { ...originalAddress, detailedAddress: 'Changed address book street 2' } },
      { actorUserId: userId },
    );
    const detail = await claimService.getDetailForUser(userId, claim.id, { actorUserId: userId });
    expect(detail.address?.detailedAddress).toBe(originalAddress.detailedAddress);

    const [otherMember] = await database.orm
      .insert(snapshotMembers)
      .values({
        biliUid: 'different-uid',
        displayNameAtSnapshot: 'Other',
        rawTier: '3',
        snapshotRunId: campaign.runId,
        sourcePosition: 2,
        tier: 'CAPTAIN',
      })
      .returning();
    const [source] = await database.orm
      .select()
      .from(entitlements)
      .where(eq(entitlements.campaignId, campaign.campaignId));
    const [otherEntitlement] = await database.orm
      .insert(entitlements)
      .values({
        biliUid: 'different-uid',
        campaignId: source!.campaignId,
        creatorId: source!.creatorId,
        giftPackageId: source!.giftPackageId,
        organizationId: source!.organizationId,
        snapshotMemberId: otherMember!.id,
        tier: source!.tier,
      })
      .returning();
    await expect(
      database.orm.insert(claimEntitlements).values({
        claimId: claim.id,
        entitlementId: otherEntitlement!.id,
      }),
    ).rejects.toThrow();

    const processing = await claimService.operatorTransition(
      claim.id,
      { target: 'PROCESSING', version: claim.version },
      { actorUserId: userId },
    );
    await expect(
      claimService.updateAddress(userId, claim.id, addressId, processing.version, {
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_FROZEN' });
    await expect(
      database.orm
        .update(claimAddresses)
        .set({ sourceAddressId: null })
        .where(eq(claimAddresses.claimId, claim.id)),
    ).rejects.toThrow();
    await expect(
      database.orm
        .update(claimOptionValues)
        .set({ fieldKey: 'changed' })
        .where(eq(claimOptionValues.claimId, claim.id)),
    ).rejects.toThrow();
    expect((await campaignService.getForUser(userId, campaign.campaignId)).displayState).toBe(
      'PROCESSING',
    );
    await expect(
      claimService.operatorTransition(
        claim.id,
        { target: 'SHIPPED', version: processing.version },
        { actorUserId: userId },
      ),
    ).rejects.toMatchObject({ code: 'CLAIM_SHIPMENT_ITEMS_INCOMPLETE' });
    await fulfillmentService.createShipment(
      claim.id,
      {
        carrierCode: 'manual',
        shipmentKey: 'frozen-box',
        trackingNumber: 'FROZEN1',
        trackingUrl: 'https://tracking.example.test/frozen',
      },
      { actorUserId: userId },
    );
    const shipped = (await claimService.listForUser(userId)).find(
      (candidate) => candidate.id === claim.id,
    )!;
    await claimService.userTransition(
      userId,
      claim.id,
      { target: 'COMPLETED', version: shipped.version },
      { actorUserId: userId },
    );
    expect((await campaignService.getForUser(userId, campaign.campaignId)).displayState).toBe(
      'COMPLETED',
    );
  });

  it('cancels and resubmits the same claim record before the database deadline', async () => {
    const campaign = await createEligibleCampaign({ title: 'Resubmission gift' });
    const submitted = await claimService.submit(
      userId,
      campaign.campaignId,
      { addressId, optionValues: { size: 'S' } },
      'resubmit-first',
      { actorUserId: userId },
    );
    const cancelled = await claimService.userTransition(
      userId,
      submitted.id,
      { reason: 'Changed my mind', target: 'CANCELLED', version: submitted.version },
      { actorUserId: userId },
    );
    const resubmitted = await claimService.submit(
      userId,
      campaign.campaignId,
      { addressId, optionValues: { size: 'M' }, version: cancelled.version },
      'resubmit-second',
      { actorUserId: userId },
    );
    expect(resubmitted.id).toBe(submitted.id);
    expect(resubmitted.claimNumber).toBe(submitted.claimNumber);
    expect(resubmitted.status).toBe('SUBMITTED');
    const history = await database.orm
      .select()
      .from(claimStatusHistory)
      .where(eq(claimStatusHistory.claimId, submitted.id));
    expect(history.map((item) => item.toStatus)).toEqual(['SUBMITTED', 'CANCELLED', 'SUBMITTED']);
  });

  it('uses database time for expiry and reports revoked projections', async () => {
    const expired = await createEligibleCampaign({
      deadline: new Date('2026-02-01T00:00:00.000Z'),
      title: 'Expired gift',
    });
    await expect(
      claimService.submit(
        userId,
        expired.campaignId,
        { addressId, optionValues: { size: 'M' } },
        'expired-claim-key',
        { actorUserId: userId },
      ),
    ).rejects.toMatchObject({ code: 'CLAIM_DEADLINE_PASSED' });
    expect((await campaignService.getForUser(userId, expired.campaignId)).displayState).toBe(
      'EXPIRED',
    );

    const revoked = await createEligibleCampaign({ title: 'Revoked gift' });
    await campaignService.revoke(revoked.entitlementId, 'Eligibility correction', {
      actorUserId: userId,
    });
    expect((await campaignService.getForUser(userId, revoked.campaignId)).displayState).toBe(
      'REVOKED',
    );
  });

  it('handles idempotent batch processing and safe key loss errors', async () => {
    const firstCampaign = await createEligibleCampaign({ title: 'Batch gift one' });
    const secondCampaign = await createEligibleCampaign({ title: 'Batch gift two' });
    const first = await claimService.submit(
      userId,
      firstCampaign.campaignId,
      { addressId, optionValues: { size: 'M' } },
      'batch-claim-one',
      { actorUserId: userId },
    );
    const second = await claimService.submit(
      userId,
      secondCampaign.campaignId,
      { addressId, optionValues: { size: 'M' } },
      'batch-claim-two',
      { actorUserId: userId },
    );
    const batch = await claimService.batchProcess(
      organizationId,
      [first.id, second.id],
      [],
      'batch-processing-key',
      { actorUserId: userId },
    );
    expect(
      await claimService.batchProcess(
        organizationId,
        [second.id, first.id],
        [],
        'batch-processing-key',
        { actorUserId: userId },
      ),
    ).toEqual(batch);

    const wrongKeyService = new ClaimService(
      database,
      new EncryptionKeyRing({
        addressEncryptionActiveKeyVersion: 1,
        addressEncryptionKeyRing: '1:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      }),
    );
    try {
      await wrongKeyService.getDetailForUser(userId, first.id, { actorUserId: userId });
      throw new Error('Expected address decryption to fail');
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(error).toMatchObject({ code: 'CLAIM_ADDRESS_DECRYPTION_FAILED' });
      expect(error.message).not.toContain(originalAddress.recipientName);
    }
  });

  it('supports multiple shipments and ships only after every package is assigned', async () => {
    const campaign = await createEligibleCampaign({
      cumulative: true,
      tier: 'ADMIRAL',
      title: 'Multi shipment gift',
    });
    const submitted = await claimService.submit(
      userId,
      campaign.campaignId,
      { addressId, optionValues: { size: 'M' } },
      'multi-shipment-claim',
      { actorUserId: userId },
    );
    const processing = await claimService.operatorTransition(
      submitted.id,
      { target: 'PROCESSING', version: submitted.version },
      { actorUserId: userId },
    );
    await expect(
      fulfillmentService.assertClaimAccess(fulfillmentSession, submitted.id, 'fulfillment.manage'),
    ).resolves.toMatchObject({ organizationId });
    await expect(
      fulfillmentService.assertOrganizationAccess(
        fulfillmentSession,
        organizationId,
        'claim.process',
      ),
    ).resolves.toBeDefined();
    await expect(
      fulfillmentService.assertOrganizationAccess(
        fulfillmentSession,
        organizationId,
        'campaign.manage',
      ),
    ).rejects.toMatchObject({ code: 'FULFILLMENT_ACCESS_DENIED' });
    const links = await database.orm
      .select({ id: claimEntitlements.id })
      .from(claimEntitlements)
      .where(eq(claimEntitlements.claimId, submitted.id));
    const firstShipment = await fulfillmentService.createShipment(
      submitted.id,
      {
        carrierCode: 'unsupported-carrier',
        claimEntitlementIds: [links[0]!.id],
        shipmentKey: 'parcel-a',
        trackingNumber: 'MULTI4',
        trackingUrl: 'https://carrier.example.test/a',
      },
      { actorUserId: userId },
    );
    expect(firstShipment.shipment.trackingUrl).toBe('https://carrier.example.test/a');
    expect(
      (await claimService.listForUser(userId)).find((claim) => claim.id === submitted.id)?.status,
    ).toBe('PROCESSING');
    const secondShipment = await fulfillmentService.createShipment(
      submitted.id,
      {
        carrierCode: 'manual',
        claimEntitlementIds: [links[1]!.id],
        shipmentKey: 'parcel-b',
        trackingNumber: 'MULTI7',
      },
      { actorUserId: userId },
    );
    expect(
      (await claimService.listForUser(userId)).find((claim) => claim.id === submitted.id)?.status,
    ).toBe('SHIPPED');
    expect(await fulfillmentService.listForUser(userId, submitted.id)).toHaveLength(2);
    await expect(
      database.orm
        .delete(shipmentItems)
        .where(eq(shipmentItems.shipmentId, firstShipment.shipment.id)),
    ).rejects.toThrow();
    const delivered = await fulfillmentService.refreshShipment(secondShipment.shipment.id, {
      actorUserId: userId,
    });
    expect(delivered.status).toBe('DELIVERED');
    const shippedClaim = (await claimService.listForUser(userId)).find(
      (claim) => claim.id === submitted.id,
    )!;
    const completed = await claimService.userTransition(
      userId,
      submitted.id,
      { target: 'COMPLETED', version: shippedClaim.version },
      { actorUserId: userId },
    );
    expect(completed.status).toBe('COMPLETED');
    expect(processing.status).toBe('PROCESSING');
  });

  it('imports shipment rows independently and replays by claim and shipment identity', async () => {
    const validCampaign = await createEligibleCampaign({ title: 'CSV fulfillment gift' });
    const submitted = await claimService.submit(
      userId,
      validCampaign.campaignId,
      { addressId, optionValues: { size: 'S' } },
      'csv-claim-key',
      { actorUserId: userId },
    );
    await claimService.operatorTransition(
      submitted.id,
      { target: 'PROCESSING', version: submitted.version },
      { actorUserId: userId },
    );
    const header = fulfillmentService.exportTemplate().split('\r\n')[0]!;
    const csv = `${header}\r\n1,${submitted.claimNumber},csv-box,manual,CSV123,,\r\n1,CLM-MISSING,bad-box,manual,BAD123,,\r\n`;
    const first = await fulfillmentService.importCsv(organizationId, [], csv, {
      actorUserId: userId,
    });
    expect(first.results.map((row) => row.status)).toEqual(['IMPORTED', 'ERROR']);
    const second = await fulfillmentService.importCsv(organizationId, [], csv, {
      actorUserId: userId,
    });
    expect(second.results.map((row) => row.status)).toEqual(['UNCHANGED', 'ERROR']);
    const [total] = await database.orm
      .select({ value: count() })
      .from(shipments)
      .where(eq(shipments.claimId, submitted.id));
    expect(total!.value).toBe(1);
  });

  it('exports every decrypted address with an audit record and no tracking dependency', async () => {
    const campaign = await createEligibleCampaign({ title: 'Address export gift' });
    const submitted = await claimService.submit(
      userId,
      campaign.campaignId,
      { addressId, optionValues: { size: 'L' } },
      'export-claim-key',
      { actorUserId: userId },
    );
    await claimService.operatorTransition(
      submitted.id,
      { target: 'PROCESSING', version: submitted.version },
      { actorUserId: userId },
    );
    const manualService = new FulfillmentService(database, keyRing, null);
    const csv = await manualService.exportClaims(
      organizationId,
      [],
      { campaignId: campaign.campaignId },
      { actorUserId: userId },
    );
    expect(csv).toContain(originalAddress.recipientName);
    expect(csv).toContain(submitted.claimNumber);
    const auditRows = await database.orm
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'fulfillment.address-exported'),
          eq(auditLogs.targetId, submitted.id),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });
});
