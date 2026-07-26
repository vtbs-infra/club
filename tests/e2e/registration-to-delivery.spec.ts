import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import {
  creators,
  entitlements,
  giftCampaigns,
  giftPackages,
  giftTierRules,
  organizationMembers,
  organizations,
  snapshotMembers,
  snapshotRuns,
  users,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createBindingRuntime } from '../../src/server/modules/binding/binding-runtime.js';
import { FakeLiveMessageSource } from '../../src/server/modules/bilibili/fake-live-message-source.js';
import { createTestConfig } from '../helpers/test-config.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
test.skip(!databaseUrl, 'DATABASE_URL or TEST_DATABASE_URL is required for the full journey.');
test.describe.configure({ mode: 'serial' });

let app: Awaited<ReturnType<typeof buildApp>>;
let database: DatabaseService;
let storage: TemporaryStorage;
let source: FakeLiveMessageSource;
let baseUrl: string;
let organizationId: string;
let creatorId: string;
let operatorId: string;
let claimId: string;
const operatorEmail = 'e2e-operator@example.com';
const recipientEmail = 'e2e-recipient@example.com';
const password = 'correct-horse-battery-staple';

test.beforeEach(async ({ context }) => {
  await context.addInitScript({
    content: "window.localStorage.setItem('club-language', 'en');",
  });
});

test.beforeAll(async () => {
  database = createDatabase(databaseUrl!);
  storage = await createTemporaryStorage();
  await database.orm.execute(sql`truncate table users, organizations, verification_rooms cascade`);
  const config = createTestConfig({
    appUrl: 'http://127.0.0.1:3211',
    databaseUrl: databaseUrl!,
    nodeEnv: 'test',
  });
  source = new FakeLiveMessageSource();
  const bindingRuntime = createBindingRuntime({
    clock: { now: () => new Date() },
    config,
    database,
    idleGraceMs: 0,
    reconnectDelaysMs: [1],
    source,
  });
  app = await buildApp({
    bindingRuntime,
    config,
    database,
    serveStatic: true,
    startBackground: false,
    storage: storage.driver,
    webRoot: resolve('dist/web'),
  });
  baseUrl = await app.listen({ host: '127.0.0.1', port: 3211 });

  const registered = await app.inject({
    method: 'POST',
    payload: { email: operatorEmail, name: 'E2E Operator', password },
    url: '/api/auth/sign-up/email',
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const [operator] = await database.orm
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, operatorEmail));
  operatorId = operator!.id;
  const [organization] = await database.orm
    .insert(organizations)
    .values({ name: 'E2E Organization', slug: 'e2e-organization' })
    .returning({ id: organizations.id });
  organizationId = organization!.id;
  await database.orm.insert(organizationMembers).values({
    organizationId,
    role: 'OWNER',
    userId: operatorId,
  });
  const [creator] = await database.orm
    .insert(creators)
    .values({
      bilibiliUid: 'e2e-creator-uid',
      displayName: 'E2E Creator',
      organizationId,
      roomId: 'e2e-creator-room',
      timezone: 'Asia/Shanghai',
    })
    .returning({ id: creators.id });
  creatorId = creator!.id;
  await database.orm.insert(verificationRooms).values({
    biliOwnerUid: 'e2e-room-owner',
    biliRoomId: 'e2e-verification-room',
    displayName: 'E2E Verification Room',
    enabled: true,
  });
});

test.afterAll(async () => {
  if (app) await app.close();
  if (database) await database.close();
  if (storage) await storage.cleanup();
});

async function seedHistoricalGift(recipientId: string) {
  const now = new Date();
  const periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const [run] = await database.orm
    .insert(snapshotRuns)
    .values({
      creatorBilibiliUid: 'e2e-creator-uid',
      creatorId,
      creatorRoomId: 'e2e-creator-room',
      cutoffTimezone: 'Asia/Shanghai',
      finalizedAt: now,
      onTimeWindowEndAt: new Date(now.getTime() - 3_600_000),
      organizationId,
      periodStart,
      scheduledCutoffAt: new Date(now.getTime() - 7_200_000),
      status: 'FINALIZED',
    })
    .returning({ id: snapshotRuns.id });
  const [member] = await database.orm
    .insert(snapshotMembers)
    .values({
      biliUid: 'e2e-recipient-uid',
      displayNameAtSnapshot: 'E2E Recipient on Bilibili',
      rawTier: '3',
      snapshotRunId: run!.id,
      sourcePosition: 1,
      tier: 'CAPTAIN',
    })
    .returning({ id: snapshotMembers.id });
  const [campaign] = await database.orm
    .insert(giftCampaigns)
    .values({
      claimDeadlineAt: new Date(now.getTime() + 30 * 86_400_000),
      claimFormSchema: [],
      claimStartAt: new Date(now.getTime() - 86_400_000),
      createdBy: operatorId,
      creatorId,
      description: 'A complete registration-to-delivery browser journey.',
      fulfillmentMode: 'HIGHEST_ONLY',
      organizationId,
      periodStart,
      title: 'E2E Guard Gift',
    })
    .returning({ id: giftCampaigns.id });
  const [giftPackage] = await database.orm
    .insert(giftPackages)
    .values({
      campaignId: campaign!.id,
      description: 'E2E package',
      name: 'E2E Captain Package',
    })
    .returning({ id: giftPackages.id });
  await database.orm.insert(giftTierRules).values({
    campaignId: campaign!.id,
    giftPackageId: giftPackage!.id,
    tier: 'CAPTAIN',
  });
  await database.orm
    .update(giftCampaigns)
    .set({ publishedAt: now, status: 'PUBLISHED' })
    .where(eq(giftCampaigns.id, campaign!.id));
  await database.orm.insert(entitlements).values({
    biliUid: 'e2e-recipient-uid',
    campaignId: campaign!.id,
    creatorId,
    giftPackageId: giftPackage!.id,
    organizationId,
    snapshotMemberId: member!.id,
    tier: 'CAPTAIN',
  });
  expect(recipientId).toBeTruthy();
}

async function signIn(page: Page, email: string, expectedHeading: RegExp) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible();
}

async function findHorizontalOverflow(page: Page) {
  return page.locator('body *').evaluateAll((elements) => {
    const viewportWidth = elements[0]?.ownerDocument.documentElement.clientWidth ?? 0;
    return elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > viewportWidth;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return `${element.tagName.toLowerCase()}.${element.className} (${Math.round(
          rect.left,
        )}..${Math.round(rect.right)})`;
      });
  });
}

test('completes registration, UID binding, eligibility, claim, shipment, and receipt', async ({
  page,
}) => {
  await page.goto(`${baseUrl}/register`);
  await page.getByLabel('Display name').fill('E2E Recipient');
  await page.getByLabel('Email').fill(recipientEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, recipientEmail, /Your organizations/);

  await page.goto(`${baseUrl}/account`);
  await page.getByRole('button', { name: /Start verification/ }).click();
  const code = await page.locator('.challenge-card code').textContent();
  expect(code).toMatch(/^CLUB-/);
  await expect.poll(() => source.activeConnectionCount('e2e-verification-room')).toBe(1);
  await source.emitMessage({
    biliDisplayName: 'E2E Recipient on Bilibili',
    biliUid: 'e2e-recipient-uid',
    eventId: 'e2e-binding-message',
    message: code!,
    roomId: 'e2e-verification-room',
  });
  await expect(page.getByText('Verified UID')).toBeVisible({ timeout: 5_000 });

  const [recipient] = await database.orm
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, recipientEmail));
  await seedHistoricalGift(recipient!.id);
  await page.reload();
  await expect(page.getByRole('heading', { exact: true, name: 'E2E Guard Gift' })).toBeVisible();

  await page.getByLabel('Recipient').fill('E2E Delivery Recipient');
  await page.getByLabel('Phone').fill('13000000000');
  await page.getByLabel('Country / region').fill('China');
  await page.getByLabel('Province').fill('Shanghai');
  await page.getByLabel('City').fill('Shanghai');
  await page.getByLabel('District').fill('Pudong');
  await page.getByLabel('Detailed address').fill('E2E encrypted street 1');
  await page.getByLabel('Postal code').fill('200000');
  await page.getByRole('button', { name: 'Add address' }).click();
  await expect(page.getByText('E2E encrypted street 1')).toBeVisible();

  await page.getByRole('link', { name: 'View gift' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Guard Gift' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit claim' }).click();
  await expect(page).toHaveURL(/\/claims\/[0-9a-f-]+$/);
  claimId = page.url().split('/').at(-1)!;
  await expect(page.getByText('SUBMITTED').first()).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, operatorEmail, /Your organizations/);
  await page.goto(`${baseUrl}/organizations/${organizationId}/fulfillment`);
  await expect(page.getByRole('heading', { name: 'Claims and shipments' })).toBeVisible();
  const claimNumber = await page.locator('.fulfillment-list .record-button strong').textContent();
  expect(claimNumber).toMatch(/^CLM-/);
  await page.getByLabel(`Select ${claimNumber}`).check();
  await page.getByRole('button', { name: 'Process selected' }).click();
  await expect(page.locator('.fulfillment-list .record-button small')).toContainText('PROCESSING');
  await page.getByRole('button', { name: new RegExp(claimNumber!) }).click();
  await page.getByLabel('Tracking number').fill('E2E-TRACK-001');
  await page.getByLabel('Public tracking URL').fill('https://carrier.example.test/E2E-TRACK-001');
  await page.getByRole('button', { name: 'Create shipment' }).click();
  await expect(page.getByText('E2E-TRACK-001')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, recipientEmail, /Your organizations/);
  await page.goto(`${baseUrl}/claims/${claimId}`);
  await expect(page.getByText('E2E-TRACK-001')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByText('COMPLETED').first()).toBeVisible();
});

test('keeps recipient account and delivery detail usable on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await signIn(page, recipientEmail, /Your organizations/);
  await page.goto(`${baseUrl}/account`);
  await expect(page.getByRole('heading', { name: 'E2E Recipient' })).toBeVisible();
  await expect(page.getByRole('heading', { exact: true, name: 'E2E Guard Gift' })).toBeVisible();
  expect(await findHorizontalOverflow(page)).toEqual([]);
  await page.goto(`${baseUrl}/claims/${claimId}`);
  await expect(page.getByText('E2E-TRACK-001')).toBeVisible();
  expect(await findHorizontalOverflow(page)).toEqual([]);
});
