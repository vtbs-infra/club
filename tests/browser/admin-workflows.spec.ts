import type { CreatorRecord } from '../../src/shared/contracts/creators.js';
import type {
  AdminSnapshotPage,
  SnapshotAttemptMemberPage,
  SnapshotDetail,
} from '../../src/shared/contracts/snapshots.js';

import { mockApi, requestJsonObject, requestPath } from './support/api.js';
import {
  adminIdentity,
  systemStatus,
  testId,
  testTime,
  userRecord,
  verificationRoom,
} from './support/fixtures.js';
import { expect, freezeBrowserTime, test } from './support/test.js';

test.beforeEach(async ({ page }) => {
  await freezeBrowserTime(page);
});

test('keeps admin editors and status badges usable at 800px', async ({ appUrl, page }) => {
  await page.setViewportSize({ height: 900, width: 800 });
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/creators') return { items: [], nextCursor: null };
    if (pathname === '/api/v1/admin/users') {
      return [userRecord()];
    }
    if (pathname === '/api/v1/admin/verification-rooms') return [verificationRoom()];
    if (pathname === '/api/v1/admin/announcements') return { items: [], nextCursor: null };
    if (pathname === '/api/v1/admin/system') return systemStatus();
    if (pathname === '/api/v1/admin/audit-logs') return { items: [], nextCursor: null };
    return undefined;
  });

  await page.goto(`${appUrl}/admin/creators`);
  await page.getByRole('button', { name: '注册主播' }).click();
  await expect(page.getByLabel('搜索已验证用户')).toBeFocused();
  await expect(page.getByLabel('搜索已验证用户')).toBeInViewport();

  await page.goto(`${appUrl}/admin/verification`);
  const verificationHealth = page.locator('.room-row .status-badge').filter({ hasText: '健康' });
  await expect(verificationHealth).toBeVisible();
  expect((await verificationHealth.boundingBox())?.width).toBeLessThan(90);
  await page.getByRole('button', { name: '添加直播间' }).click();
  await expect(page.getByLabel('显示名称')).toBeFocused();
  await expect(page.getByLabel('显示名称')).toBeInViewport();

  await page.goto(`${appUrl}/admin/announcements`);
  await page.getByRole('button', { name: '新建公告' }).click();
  await expect(page.getByLabel('标题')).toBeFocused();
  await expect(page.getByLabel('标题')).toBeInViewport();

  await page.goto(`${appUrl}/admin/system`);
  const systemHealth = page
    .locator('.simple-list.roster .status-badge')
    .filter({ hasText: '健康' });
  await expect(systemHealth).toBeVisible();
  expect((await systemHealth.boundingBox())?.width).toBeLessThan(90);
});

test('shows the exact late-attempt members before approval', async ({ appUrl, page }) => {
  let approvalInput: Record<string, unknown> | null = null;
  const creatorId = testId(60);
  const runId = testId(61);
  const attemptId = testId(62);
  const run = {
    acceptedAttemptId: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: testTime(-2),
    creatorBilibiliUid: '90001',
    creatorId,
    creatorRoomId: '80001',
    cutoffTimezone: 'Asia/Shanghai',
    finalizedAt: null,
    id: runId,
    onTimeWindowEndAt: testTime(-1),
    periodStart: '2026-08-01',
    scheduledCutoffAt: testTime(-1),
    status: 'PENDING_APPROVAL' as const,
    updatedAt: testTime(),
  };
  const attempt = {
    attemptNumber: 1,
    captureCompletedAt: testTime(),
    captureStartedAt: testTime(),
    consistencyStatus: 'CONSISTENT' as const,
    createdAt: testTime(),
    declaredTotal: 1,
    failureCode: null,
    failureMessage: null,
    id: attemptId,
    initiatedBy: 'SCHEDULER' as const,
    normalizedTotal: 1,
    punctuality: 'LATE' as const,
    requestedByUserId: null,
    schedulerStartedAt: testTime(),
    snapshotRunId: runId,
    sourceName: 'test',
    sourceVersion: '1',
  };
  const rosterPage = {
    items: [{ creator: { displayName: '候选主播', id: creatorId }, run }],
    nextCursor: null,
  } satisfies AdminSnapshotPage;
  const detail = {
    attempts: [attempt],
    creator: { displayName: '候选主播', id: creatorId },
    evidence: { memberCount: 0, pageCount: 0 },
    retry: { canRetry: false, remainingAttempts: 2 },
    run,
  } satisfies SnapshotDetail;
  const candidates = {
    items: [
      {
        biliUid: '10001',
        createdAt: testTime(),
        displayNameAtCapture: '待确认舰长',
        id: testId(63),
        rawTier: '3',
        snapshotAttemptId: attemptId,
        sourcePage: 1,
        sourcePosition: 1,
        tier: 'CAPTAIN',
      },
    ],
    nextCursor: null,
  } satisfies SnapshotAttemptMemberPage;
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/rosters') return rosterPage;
    if (pathname === `/api/v1/admin/rosters/${runId}`) return detail;
    if (pathname === `/api/v1/admin/rosters/${runId}/approve-late`) {
      approvalInput = requestJsonObject(request);
      return {};
    }
    if (pathname === `/api/v1/admin/rosters/${runId}/attempts/${attemptId}/members`) {
      return candidates;
    }
    return undefined;
  });

  await page.goto(`${appUrl}/admin/rosters`);
  await page.getByRole('button', { name: /候选主播/ }).click();
  await expect(page.getByRole('heading', { name: '待确认成员' })).toBeVisible();
  await expect(page.getByText('待确认舰长')).toBeVisible();
  await page.getByRole('button', { name: '确认并冻结' }).click();
  const dialog = page.getByRole('dialog', { name: '确认冻结这次迟到名单？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认并冻结' }).click();
  await expect.poll(() => approvalInput).toEqual({ expectedAttemptId: attemptId });
});

test('registers a creator from verified identity without editable Bilibili fields', async ({
  appUrl,
  page,
}) => {
  const candidate = userRecord({ bilibiliUid: '90001' });
  const creator = {
    bilibiliUid: candidate.bilibiliUid!,
    createdAt: testTime(-2),
    displayName: 'B站主播',
    username: candidate.username,
    id: testId(43),
    monthlySyncEnabled: true,
    profileSyncedAt: testTime(),
    roomId: '654321',
    timezone: 'Asia/Tokyo',
    userId: candidate.id,
    userName: candidate.name,
  } satisfies CreatorRecord;
  const refreshedCreator = {
    ...creator,
    displayName: 'B站主播新昵称',
    profileSyncedAt: testTime(1),
    roomId: '654322',
  };
  let creators: readonly CreatorRecord[] = [];
  let createPayload: Record<string, unknown> | null = null;
  let profileRefreshes = 0;

  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/users') return [candidate];
    if (pathname === '/api/v1/admin/creators' && request.method() === 'POST') {
      createPayload = requestJsonObject(request);
      creators = [creator];
      return creator;
    }
    if (pathname === '/api/v1/admin/creators') return { items: creators, nextCursor: null };
    if (pathname === `/api/v1/admin/creators/${creator.id}/refresh-profile`) {
      profileRefreshes += 1;
      creators = [refreshedCreator];
      return refreshedCreator;
    }
    return undefined;
  });

  await page.goto(`${appUrl}/admin/creators`);
  await page.getByRole('button', { name: '注册主播' }).click();
  await page.getByLabel('搜索已验证用户').fill(candidate.name);
  await page.getByLabel('普通用户账号').selectOption(candidate.id);
  await expect(page.getByText('UID 90001', { exact: true })).toBeVisible();
  await expect(page.locator('form').getByLabel('显示名称')).toHaveCount(0);
  await expect(page.locator('form').getByLabel('B站 UID')).toHaveCount(0);
  await expect(page.locator('form').getByLabel('直播间 ID')).toHaveCount(0);
  await page.getByLabel('名单结算时区').fill('Asia/Tokyo');
  await page.getByRole('button', { name: '注册为主播' }).click();

  await expect
    .poll(() => createPayload)
    .toEqual({
      monthlySyncEnabled: true,
      timezone: 'Asia/Tokyo',
      userId: candidate.id,
    });
  await page.locator('.creator-admin-row').click();
  await page.getByRole('button', { name: '刷新 B站资料' }).click();
  await expect.poll(() => profileRefreshes).toBe(1);
  await expect(page.getByRole('heading', { name: 'B站主播新昵称' })).toBeVisible();
  await expect(page.getByText(/直播间 654322/)).toBeVisible();
});

test('shows and recovers from a failed creator candidate search', async ({ appUrl, page }) => {
  const candidate = userRecord();
  let searchRequests = 0;
  let finishRetry: () => void = () => undefined;
  const retryMayFinish = new Promise<void>((resolve) => {
    finishRetry = () => resolve();
  });
  await mockApi(page, (request) => {
    const pathname = requestPath(request);
    if (pathname === '/api/v1/me') return adminIdentity();
    if (pathname === '/api/v1/admin/creators') return { items: [], nextCursor: null };
    return undefined;
  });
  await page.route('**/api/v1/admin/users?*', async (route) => {
    searchRequests += 1;
    if (searchRequests === 1) {
      await route.fulfill({
        json: {
          error: {
            code: 'USER_SEARCH_UNAVAILABLE',
            message: '用户搜索暂时不可用。',
          },
        },
        status: 503,
      });
      return;
    }
    await retryMayFinish;
    await route.fulfill({ json: [candidate] });
  });

  try {
    await page.goto(`${appUrl}/admin/creators`);
    await page.getByLabel('搜索已验证用户').fill(candidate.name);
    await expect(page.getByText('服务器暂时无法完成请求，请稍后重试。')).toBeVisible();
    await page.getByRole('button', { name: '重新搜索' }).click();
    await expect(page.getByText('正在搜索已验证用户…')).toBeVisible();
    finishRetry();
    await expect(page.getByLabel('普通用户账号')).toContainText(`UID ${candidate.bilibiliUid}`);
    expect(searchRequests).toBe(2);
  } finally {
    finishRetry();
  }
});
