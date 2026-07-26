import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { eq } from 'drizzle-orm';

import { loadConfig } from './config/env.js';
import { createDatabase } from './infrastructure/db/database.js';
import {
  addresses,
  claimAddresses,
  claims,
  creators,
  giftCampaigns,
  organizationMembers,
  organizations,
  shipments,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
  users,
} from './infrastructure/db/schema.js';
import { EncryptionKeyRing, type EncryptedValue } from './infrastructure/encryption/key-ring.js';
import { LocalStorageDriver } from './infrastructure/storage/local-storage.js';

const fixture = {
  addressId: '80000000-0000-4000-8000-000000000009',
  campaignId: '80000000-0000-4000-8000-000000000007',
  claimAddressId: '80000000-0000-4000-8000-00000000000a',
  claimId: '80000000-0000-4000-8000-000000000008',
  creatorId: '80000000-0000-4000-8000-000000000003',
  memberId: '80000000-0000-4000-8000-000000000006',
  organizationId: '80000000-0000-4000-8000-000000000002',
  organizationMemberId: '80000000-0000-4000-8000-00000000000c',
  pageKey: 'snapshot-pages/recovery-probe/page-1.json.gz',
  runId: '80000000-0000-4000-8000-000000000004',
  shipmentId: '80000000-0000-4000-8000-00000000000b',
  snapshotAttemptId: '80000000-0000-4000-8000-000000000005',
  userId: '80000000-0000-4000-8000-000000000001',
} as const;

const addressPayload = {
  city: 'Shanghai',
  countryRegion: 'China',
  detailedAddress: 'Recovery Probe Street 8',
  district: 'Pudong',
  phone: '13000000000',
  postalCode: '200000',
  province: 'Shanghai',
  recipientName: 'Recovery Probe Recipient',
} as const;

function encryptedColumns(value: EncryptedValue) {
  return {
    authenticationTag: value.authenticationTag,
    ciphertext: value.ciphertext,
    initializationVector: value.initializationVector,
    keyVersion: value.keyVersion,
  };
}

function isRecoveryPage(value: unknown): value is { readonly marker: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'marker' in value &&
    value.marker === 'club-recovery-probe-v1'
  );
}

async function seed() {
  if (process.env.RECOVERY_PROBE_CONFIRM !== 'seed-empty-database') {
    throw new Error('Set RECOVERY_PROBE_CONFIRM=seed-empty-database to seed the recovery probe.');
  }

  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const encryption = new EncryptionKeyRing(config);
  const storage = new LocalStorageDriver(config.storageLocalPath);
  const now = new Date('2026-07-01T00:00:00.000Z');
  const rawPage = Buffer.from(
    JSON.stringify({
      marker: 'club-recovery-probe-v1',
      members: [{ biliUid: 'recovery-probe-uid', tier: 'CAPTAIN' }],
    }),
    'utf8',
  );
  const compressedPage = gzipSync(rawPage);
  const pageHash = createHash('sha256').update(rawPage).digest('hex');

  try {
    const existing = await database.orm.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) {
      throw new Error('Recovery probe seed refused: the database is not empty.');
    }

    await storage.put({ data: compressedPage, key: fixture.pageKey });
    await database.orm.transaction(async (transaction) => {
      await transaction.insert(users).values({
        email: 'recovery-probe@example.invalid',
        emailVerified: true,
        id: fixture.userId,
        name: 'Recovery Probe User',
      });
      await transaction.insert(organizations).values({
        id: fixture.organizationId,
        name: 'Recovery Probe Organization',
        slug: 'recovery-probe',
      });
      await transaction.insert(organizationMembers).values({
        id: fixture.organizationMemberId,
        organizationId: fixture.organizationId,
        role: 'OWNER',
        userId: fixture.userId,
      });
      await transaction.insert(creators).values({
        bilibiliUid: 'recovery-probe-creator',
        displayName: 'Recovery Probe Creator',
        id: fixture.creatorId,
        organizationId: fixture.organizationId,
        roomId: 'recovery-probe-room',
        timezone: 'Asia/Shanghai',
      });
      await transaction.insert(snapshotRuns).values({
        creatorBilibiliUid: 'recovery-probe-creator',
        creatorId: fixture.creatorId,
        creatorRoomId: 'recovery-probe-room',
        cutoffTimezone: 'Asia/Shanghai',
        finalizedAt: now,
        id: fixture.runId,
        onTimeWindowEndAt: now,
        organizationId: fixture.organizationId,
        periodStart: '2026-07-01',
        scheduledCutoffAt: now,
        status: 'FINALIZED',
      });
      await transaction.insert(snapshotAttempts).values({
        attemptNumber: 1,
        captureCompletedAt: now,
        captureStartedAt: now,
        consistencyStatus: 'CONSISTENT',
        declaredTotal: 1,
        id: fixture.snapshotAttemptId,
        normalizedTotal: 1,
        punctuality: 'ON_TIME',
        schedulerStartedAt: now,
        snapshotRunId: fixture.runId,
        sourceName: 'recovery-probe',
        sourceVersion: '1',
      });
      await transaction
        .update(snapshotRuns)
        .set({ acceptedAttemptId: fixture.snapshotAttemptId })
        .where(eq(snapshotRuns.id, fixture.runId));
      await transaction.insert(snapshotPages).values({
        compressedSize: compressedPage.byteLength,
        contentEncoding: 'gzip',
        contentHashSha256: pageHash,
        fetchedAt: now,
        itemCount: 1,
        objectKey: fixture.pageKey,
        pageNumber: 1,
        snapshotAttemptId: fixture.snapshotAttemptId,
        uncompressedSize: rawPage.byteLength,
      });
      await transaction.insert(snapshotMembers).values({
        biliUid: 'recovery-probe-uid',
        displayNameAtSnapshot: 'Recovery Probe Member',
        id: fixture.memberId,
        rawTier: '3',
        snapshotRunId: fixture.runId,
        sourcePosition: 1,
        tier: 'CAPTAIN',
      });
      await transaction.insert(giftCampaigns).values({
        claimDeadlineAt: new Date('2026-08-31T00:00:00.000Z'),
        claimFormSchema: [],
        claimStartAt: now,
        createdBy: fixture.userId,
        creatorId: fixture.creatorId,
        description: 'Combined backup and restore probe.',
        fulfillmentMode: 'HIGHEST_ONLY',
        id: fixture.campaignId,
        organizationId: fixture.organizationId,
        periodStart: '2026-07-01',
        publishedAt: now,
        status: 'PUBLISHED',
        title: 'Recovery Probe Gift',
      });
      const encryptedAddress = encryption.encrypt(addressPayload, `address:${fixture.addressId}`);
      await transaction.insert(addresses).values({
        id: fixture.addressId,
        isDefault: true,
        label: 'Recovery Probe Address',
        userId: fixture.userId,
        ...encryptedColumns(encryptedAddress),
      });
      await transaction.insert(claims).values({
        biliUid: 'recovery-probe-uid',
        campaignId: fixture.campaignId,
        claimNumber: 'CLM-RECOVERY-PROBE',
        creatorId: fixture.creatorId,
        id: fixture.claimId,
        organizationId: fixture.organizationId,
        status: 'SUBMITTED',
        submittedAt: now,
        userId: fixture.userId,
        version: 1,
      });
      const encryptedClaimAddress = encryption.encrypt(
        addressPayload,
        `claim-address:${fixture.claimId}`,
      );
      await transaction.insert(claimAddresses).values({
        claimId: fixture.claimId,
        id: fixture.claimAddressId,
        sourceAddressId: fixture.addressId,
        ...encryptedColumns(encryptedClaimAddress),
      });
      await transaction
        .update(claims)
        .set({
          processingAt: now,
          status: 'PROCESSING',
          version: 2,
        })
        .where(eq(claims.id, fixture.claimId));
      await transaction.insert(shipments).values({
        carrierCode: 'manual',
        claimId: fixture.claimId,
        creatorId: fixture.creatorId,
        deliveredAt: now,
        id: fixture.shipmentId,
        organizationId: fixture.organizationId,
        shipmentKey: 'recovery-probe-box',
        shipmentNumber: 'SHP-RECOVERY-PROBE',
        status: 'DELIVERED',
        trackingNumber: 'RECOVERY-PROBE-TRACKING',
        trackingUrl: 'https://example.invalid/recovery-probe',
      });
      await transaction
        .update(claims)
        .set({ shippedAt: now, status: 'SHIPPED', version: 3 })
        .where(eq(claims.id, fixture.claimId));
      await transaction
        .update(claims)
        .set({ completedAt: now, status: 'COMPLETED', version: 4 })
        .where(eq(claims.id, fixture.claimId));
    });
    console.log(
      JSON.stringify({
        address: fixture.addressId,
        claim: fixture.claimId,
        file: fixture.pageKey,
        result: 'seeded',
        shipment: fixture.shipmentId,
        snapshot: fixture.runId,
        user: fixture.userId,
      }),
    );
  } finally {
    await database.close();
  }
}

async function verify() {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const encryption = new EncryptionKeyRing(config);
  const storage = new LocalStorageDriver(config.storageLocalPath);

  try {
    const [user] = await database.orm.select().from(users).where(eq(users.id, fixture.userId));
    const [address] = await database.orm
      .select()
      .from(addresses)
      .where(eq(addresses.id, fixture.addressId));
    const [claimAddress] = await database.orm
      .select()
      .from(claimAddresses)
      .where(eq(claimAddresses.id, fixture.claimAddressId));
    const [page] = await database.orm
      .select()
      .from(snapshotPages)
      .where(eq(snapshotPages.snapshotAttemptId, fixture.snapshotAttemptId));
    const [claim] = await database.orm.select().from(claims).where(eq(claims.id, fixture.claimId));
    const [shipment] = await database.orm
      .select()
      .from(shipments)
      .where(eq(shipments.id, fixture.shipmentId));
    if (!user || !address || !claimAddress || !page || !claim || !shipment) {
      throw new Error('Recovery probe verification failed: required database rows are missing.');
    }

    const decryptedAddress = encryption.decrypt<typeof addressPayload>(
      {
        authenticationTag: address.authenticationTag,
        ciphertext: address.ciphertext,
        initializationVector: address.initializationVector,
        keyVersion: address.keyVersion,
      },
      `address:${address.id}`,
    );
    const decryptedClaimAddress = encryption.decrypt<typeof addressPayload>(
      {
        authenticationTag: claimAddress.authenticationTag,
        ciphertext: claimAddress.ciphertext,
        initializationVector: claimAddress.initializationVector,
        keyVersion: claimAddress.keyVersion,
      },
      `claim-address:${claim.id}`,
    );
    if (
      decryptedAddress.detailedAddress !== addressPayload.detailedAddress ||
      decryptedClaimAddress.detailedAddress !== addressPayload.detailedAddress
    ) {
      throw new Error('Recovery probe verification failed: address decryption mismatch.');
    }

    const compressedPage = Buffer.from(
      await new Response(await storage.open(page.objectKey)).arrayBuffer(),
    );
    const rawPage = gunzipSync(compressedPage);
    const pageHash = createHash('sha256').update(rawPage).digest('hex');
    const pagePayload: unknown = JSON.parse(rawPage.toString('utf8'));
    if (pageHash !== page.contentHashSha256 || !isRecoveryPage(pagePayload)) {
      throw new Error('Recovery probe verification failed: snapshot file integrity mismatch.');
    }
    if (claim.claimNumber !== 'CLM-RECOVERY-PROBE' || claim.status !== 'COMPLETED') {
      throw new Error('Recovery probe verification failed: claim mismatch.');
    }
    if (shipment.shipmentNumber !== 'SHP-RECOVERY-PROBE' || shipment.status !== 'DELIVERED') {
      throw new Error('Recovery probe verification failed: shipment mismatch.');
    }

    console.log(
      JSON.stringify({
        addressDecrypted: true,
        claim: claim.claimNumber,
        fileHashVerified: true,
        result: 'verified',
        shipment: shipment.shipmentNumber,
        snapshot: fixture.runId,
        user: user.email,
      }),
    );
  } finally {
    await database.close();
  }
}

const command = process.argv[2];
if (command === 'seed') await seed();
else if (command === 'verify') await verify();
else throw new Error('Usage: recovery-probe <seed|verify>');
