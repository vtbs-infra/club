import type { AddressRecord } from '../../../src/shared/contracts/addresses.js';
import type { Announcement } from '../../../src/shared/contracts/announcements.js';
import type { BilibiliBinding } from '../../../src/shared/contracts/binding.js';
import type { Identity, UserRecord } from '../../../src/shared/contracts/creators.js';
import type { GiftOrder, GiftRelease } from '../../../src/shared/contracts/gifts.js';
import type { PortalHome } from '../../../src/shared/contracts/portal.js';
import type { SystemStatus } from '../../../src/shared/contracts/system.js';
import type { VerificationRoom } from '../../../src/shared/contracts/verification-rooms.js';
import { TEST_NOW } from './test.js';

const DAY_MS = 86_400_000;

export function testId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

export function testTime(daysFromNow = 0): string {
  return new Date(TEST_NOW.getTime() + daysFromNow * DAY_MS).toISOString();
}

export function recipientIdentity(user: Partial<Identity['user']> = {}): Identity {
  return {
    creator: null,
    user: {
      email: 'viewer@example.com',
      id: testId(1),
      image: null,
      name: '测试用户',
      role: 'USER',
      ...user,
    },
  };
}

export function creatorIdentity(
  overrides: {
    readonly creator?: Partial<NonNullable<Identity['creator']>>;
    readonly user?: Partial<Identity['user']>;
  } = {},
): Identity {
  return {
    creator: {
      active: true,
      bilibiliUid: '90001',
      displayName: '测试主播',
      id: testId(32),
      roomId: '80001',
      timezone: 'Asia/Shanghai',
      ...overrides.creator,
    },
    user: {
      email: 'creator@example.com',
      id: testId(33),
      image: null,
      name: '主播账号',
      role: 'CREATOR',
      ...overrides.user,
    },
  };
}

export function adminIdentity(user: Partial<Identity['user']> = {}): Identity {
  return {
    creator: null,
    user: {
      email: 'admin@example.com',
      id: testId(40),
      image: null,
      name: '平台管理员',
      role: 'PLATFORM_ADMIN',
      ...user,
    },
  };
}

export function portalHome(overrides: Partial<PortalHome> = {}): PortalHome {
  return {
    announcements: [],
    releases: [],
    ...overrides,
  };
}

type GiftOrderOverrides = Omit<Partial<GiftOrder>, 'creator' | 'release'> & {
  readonly creator?: Partial<GiftOrder['creator']>;
  readonly release?: Partial<GiftOrder['release']>;
};

export function giftOrder(overrides: GiftOrderOverrides = {}): GiftOrder {
  const { creator, release, ...order } = overrides;
  return {
    biliDisplayName: '测试舰长',
    biliUid: '10001',
    cancelledAt: null,
    completedAt: null,
    creator: {
      displayName: '测试主播',
      id: testId(2),
      ...creator,
    },
    expiresAt: testTime(30),
    id: testId(3),
    items: [
      {
        description: '',
        id: testId(4),
        items: [{ description: '', name: '纪念徽章', quantity: 1 }],
        name: '舰长礼物',
      },
    ],
    orderNumber: 'G202607-TEST0001',
    release: {
      claimDeadlineAt: testTime(30),
      claimStartAt: testTime(-30),
      coverImageUrl: null,
      description: '七月舰长纪念礼物',
      eligibilityMonth: '2026-07-01',
      formFields: [],
      id: testId(5),
      title: '七月舰长礼物',
      ...release,
    },
    shipments: [],
    shippedAt: null,
    status: 'CLAIMABLE',
    submittedAt: null,
    tier: 'CAPTAIN',
    updatedAt: testTime(-1),
    version: 1,
    ...order,
  };
}

type GiftReleaseOverrides = Omit<Partial<GiftRelease>, 'packages'> & {
  readonly packages?: GiftRelease['packages'];
};

export function giftRelease(overrides: GiftReleaseOverrides = {}): GiftRelease {
  const { packages, ...release } = overrides;
  return {
    claimDeadlineAt: testTime(30),
    claimStartAt: testTime(-30),
    closedAt: null,
    coverObjectKey: null,
    createdAt: testTime(-10),
    description: '七月纪念礼物',
    eligibilityMonth: '2026-07-01',
    formFields: [],
    fulfillmentMode: 'HIGHEST_ONLY',
    id: testId(30),
    packages: packages ?? [
      {
        description: '',
        id: testId(31),
        items: [{ description: '', name: '纪念徽章', quantity: 1 }],
        name: '舰长礼物',
      },
    ],
    publicVisible: false,
    publishedAt: null,
    status: 'DRAFT',
    tierPackageIndexes: { ADMIRAL: 0, CAPTAIN: 0, GOVERNOR: 0 },
    title: '旧标题',
    updatedAt: testTime(-10),
    version: 3,
    ...release,
  };
}

export function addressRecord(overrides: Partial<AddressRecord> = {}): AddressRecord {
  return {
    createdAt: testTime(-2),
    id: testId(25),
    isDefault: false,
    label: '办公室',
    payload: {
      city: '上海市',
      countryRegion: '中国大陆',
      detailedAddress: '测试路 1 号',
      district: '浦东新区',
      phone: '13800138001',
      postalCode: '200000',
      province: '上海市',
      recipientName: '办公室收件人',
      userNote: '',
    },
    updatedAt: testTime(-2),
    ...overrides,
  };
}

export function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    body: '新版 Club 已上线。',
    createdAt: testTime(-1),
    expiresAt: null,
    id: testId(6),
    pinned: true,
    publicVisible: false,
    publishedAt: testTime(-1),
    read: false,
    scope: 'PLATFORM',
    severity: 'INFO',
    title: '欢迎使用 Club',
    updatedAt: testTime(-1),
    version: 1,
    ...overrides,
  };
}

export function bilibiliBinding(overrides: Partial<BilibiliBinding> = {}): BilibiliBinding {
  return {
    biliDisplayName: '测试舰长',
    biliUid: '10001',
    boundAt: testTime(-1),
    id: testId(7),
    ...overrides,
  };
}

export function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    email: 'candidate@example.com',
    id: testId(41),
    name: '候选主播',
    role: 'USER',
    ...overrides,
  };
}

export function verificationRoom(overrides: Partial<VerificationRoom> = {}): VerificationRoom {
  return {
    biliRoomId: '123456',
    displayName: '主验证直播间',
    enabled: true,
    healthStatus: 'HEALTHY',
    id: testId(42),
    lastConnectedAt: testTime(),
    priority: 1,
    ...overrides,
  };
}

export function systemStatus(overrides: Partial<SystemStatus> = {}): SystemStatus {
  const runtime = {
    lastErrorAt: null,
    lastErrorCode: null,
    lastSuccessAt: null,
    lastTickAt: null,
    nextRetryAt: null,
    startedAt: null,
    state: 'RUNNING' as const,
  };
  return {
    checks: { database: 'ok', schema: 'ok', storage: 'ok' },
    integrityWarnings: [],
    recentSnapshotFailures: [],
    rooms: [
      {
        displayName: '主验证直播间',
        enabled: true,
        healthStatus: 'HEALTHY',
        lastConnectedAt: testTime(),
      },
    ],
    runtimes: {
      binding: runtime,
      roster: runtime,
      tracking: { ...runtime, configured: false },
    },
    shipmentCounts: {},
    snapshotRunCounts: {},
    status: 'ok',
    trackingDueCount: 0,
    version: '0.1.0',
    ...overrides,
  };
}
