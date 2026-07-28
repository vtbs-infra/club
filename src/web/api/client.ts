import { apiRequest } from './http';

export type AccountRole = 'USER' | 'CREATOR' | 'PLATFORM_ADMIN';
export type GuardTier = 'CAPTAIN' | 'ADMIRAL' | 'GOVERNOR';
export type GiftOrderStatus =
  'CLAIMABLE' | 'SUBMITTED' | 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

export interface Identity {
  readonly creator: {
    readonly active: boolean;
    readonly bilibiliUid: string;
    readonly displayName: string;
    readonly id: string;
    readonly roomId: string;
    readonly timezone: string;
  } | null;
  readonly user: {
    readonly email: string;
    readonly id: string;
    readonly image: null | string;
    readonly name: string;
    readonly role: AccountRole;
  };
}

export interface BilibiliBinding {
  readonly biliDisplayName: null | string;
  readonly biliUid: string;
  readonly boundAt: string;
  readonly id: string;
}

export interface BilibiliChallenge {
  readonly connectionState: 'CONNECTING' | 'HEALTHY' | 'UNHEALTHY' | null;
  readonly expiresAt: string;
  readonly id: string;
  readonly room: { readonly displayName: string; readonly link: string };
  readonly status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED' | 'CONFLICT';
}

export interface IssuedBilibiliChallenge {
  readonly code: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly room: {
    readonly displayName: string;
    readonly id: string;
    readonly link: string;
  };
}

export interface AddressPayload {
  readonly city: string;
  readonly countryRegion: string;
  readonly detailedAddress: string;
  readonly district: string;
  readonly phone: string;
  readonly postalCode: string;
  readonly province: string;
  readonly recipientName: string;
  readonly userNote: string;
}

export interface AddressRecord {
  readonly createdAt: string;
  readonly id: string;
  readonly isDefault: boolean;
  readonly label: string;
  readonly payload: AddressPayload;
  readonly updatedAt: string;
}

export interface Announcement {
  readonly body: string;
  readonly createdAt: string;
  readonly expiresAt: null | string;
  readonly id: string;
  readonly pinned: boolean;
  readonly publishedAt: null | string;
  readonly read?: boolean;
  readonly scope: 'PLATFORM' | 'CREATOR';
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
  readonly title: string;
  readonly version: number;
}

export interface GiftFormField {
  readonly key: string;
  readonly label: string;
  readonly options?: readonly string[];
  readonly required: boolean;
  readonly type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'RADIO' | 'CHECKBOX';
}

export interface GiftOrder {
  readonly biliDisplayName: string;
  readonly biliUid: string;
  readonly cancelledAt: null | string;
  readonly completedAt: null | string;
  readonly creator: {
    readonly displayName: string;
    readonly id: string;
  };
  readonly expiresAt: string;
  readonly id: string;
  readonly items: readonly {
    readonly description: string;
    readonly id: string;
    readonly items: readonly {
      readonly description: string;
      readonly name: string;
      readonly quantity: number;
    }[];
    readonly name: string;
  }[];
  readonly orderNumber: string;
  readonly processingAt: null | string;
  readonly release: {
    readonly claimDeadlineAt: string;
    readonly claimStartAt: string;
    readonly coverImageUrl: null | string;
    readonly description: string;
    readonly eligibilityMonth: string;
    readonly formFields: readonly GiftFormField[];
    readonly id: string;
    readonly title: string;
  };
  readonly shipments: readonly {
    readonly carrierName: string;
    readonly createdAt: string;
    readonly events: readonly {
      readonly description: string;
      readonly location: null | string;
      readonly occurredAt: string;
      readonly status: string;
    }[];
    readonly id: string;
    readonly status: string;
    readonly trackingNumber: string;
    readonly trackingUrl: null | string;
  }[];
  readonly shippedAt: null | string;
  readonly status: GiftOrderStatus;
  readonly submittedAt: null | string;
  readonly tier: GuardTier;
  readonly updatedAt: string;
  readonly version: number;
}

export interface CreatorOrder extends GiftOrder {
  readonly deliveryAddress: AddressPayload | null;
  readonly optionValues: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: boolean | string;
  }[];
}

export interface ReleasePackageInput {
  readonly description: string;
  readonly items: readonly {
    readonly description: string;
    readonly name: string;
    readonly quantity: number;
  }[];
  readonly name: string;
}

export interface ReleaseInput {
  readonly claimDeadlineAt: string;
  readonly claimStartAt: string;
  readonly description: string;
  readonly eligibilityMonth: string;
  readonly formFields: readonly GiftFormField[];
  readonly fulfillmentMode: 'HIGHEST_ONLY' | 'CUMULATIVE';
  readonly packages: readonly ReleasePackageInput[];
  readonly tierPackageIndexes: Readonly<Record<GuardTier, number>>;
  readonly title: string;
}

export interface GiftRelease {
  readonly claimDeadlineAt: string;
  readonly claimStartAt: string;
  readonly closedAt: null | string;
  readonly coverObjectKey: null | string;
  readonly createdAt: string;
  readonly description: string;
  readonly eligibilityMonth: string;
  readonly formFields?: readonly GiftFormField[];
  readonly fulfillmentMode: 'HIGHEST_ONLY' | 'CUMULATIVE';
  readonly id: string;
  readonly packages?: readonly {
    readonly description: string;
    readonly id: string;
    readonly items: readonly {
      readonly description: string;
      readonly name: string;
      readonly quantity: number;
    }[];
    readonly name: string;
  }[];
  readonly publishedAt: null | string;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  readonly tierPackageIndexes?: Partial<Record<GuardTier, number>>;
  readonly title: string;
  readonly updatedAt: string;
}

export interface CreatorRecord {
  readonly active: boolean;
  readonly archivedAt: null | string;
  readonly bilibiliUid: string;
  readonly displayName: string;
  readonly email: string;
  readonly id: string;
  readonly roomId: string;
  readonly timezone: string;
  readonly userId: string;
  readonly userName: string;
}

export interface UserRecord {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly role: AccountRole;
}

export interface SnapshotRun {
  readonly acceptedAttemptId: null | string;
  readonly approvedAt: null | string;
  readonly creatorId: string;
  readonly finalizedAt: null | string;
  readonly id: string;
  readonly onTimeWindowEndAt: string;
  readonly periodStart: string;
  readonly scheduledCutoffAt: string;
  readonly status:
    'SCHEDULED' | 'RUNNING' | 'FAILED' | 'PENDING_APPROVAL' | 'FINALIZED' | 'REJECTED';
}

export interface AdminSnapshot {
  readonly creator: { readonly displayName: string; readonly id: string };
  readonly run: SnapshotRun;
}

export interface VerificationRoom {
  readonly biliOwnerUid: string;
  readonly biliRoomId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly healthStatus: 'UNKNOWN' | 'CONNECTING' | 'HEALTHY' | 'UNHEALTHY';
  readonly id: string;
  readonly lastConnectedAt: null | string;
  readonly priority: number;
}

export function getIdentity(): Promise<Identity> {
  return apiRequest('/api/v1/me');
}

export function signIn(email: string, password: string): Promise<unknown> {
  return apiRequest('/api/auth/sign-in/email', {
    body: JSON.stringify({ email, password }),
    method: 'POST',
  });
}

export function registerAccount(email: string, name: string, password: string): Promise<unknown> {
  return apiRequest('/api/auth/sign-up/email', {
    body: JSON.stringify({ email, name, password }),
    method: 'POST',
  });
}

export function signOut(): Promise<unknown> {
  return apiRequest('/api/auth/sign-out', { method: 'POST' });
}

export function getBinding(): Promise<BilibiliBinding | null> {
  return apiRequest('/api/v1/me/bilibili-binding');
}

export function getChallenge(): Promise<BilibiliChallenge | null> {
  return apiRequest('/api/v1/me/bilibili-challenges/current');
}

export function createChallenge(): Promise<IssuedBilibiliChallenge> {
  return apiRequest('/api/v1/me/bilibili-challenges', {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function unbindBilibili(): Promise<void> {
  return apiRequest('/api/v1/me/bilibili-binding', { method: 'DELETE' });
}

export function getAddresses(): Promise<readonly AddressRecord[]> {
  return apiRequest('/api/v1/me/addresses');
}

export function createAddress(input: {
  readonly isDefault: boolean;
  readonly label: string;
  readonly payload: AddressPayload;
}): Promise<AddressRecord> {
  return apiRequest('/api/v1/me/addresses', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateAddress(
  addressId: string,
  input: {
    readonly isDefault: boolean;
    readonly label: string;
    readonly payload: AddressPayload;
  },
): Promise<AddressRecord> {
  return apiRequest(`/api/v1/me/addresses/${addressId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteAddress(addressId: string): Promise<void> {
  return apiRequest(`/api/v1/me/addresses/${addressId}`, { method: 'DELETE' });
}

export function getAnnouncements(limit?: number): Promise<readonly Announcement[]> {
  return apiRequest(`/api/v1/me/announcements${limit ? `?limit=${limit}` : ''}`);
}

export function markAnnouncementRead(announcementId: string): Promise<void> {
  return apiRequest(`/api/v1/me/announcements/${announcementId}/read`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function getMyGifts(limit?: number): Promise<readonly GiftOrder[]> {
  return apiRequest(`/api/v1/me/gifts${limit ? `?limit=${limit}` : ''}`);
}

export function getMyGift(giftOrderId: string): Promise<GiftOrder> {
  return apiRequest(`/api/v1/me/gifts/${giftOrderId}`);
}

export function submitGift(
  giftOrderId: string,
  input: {
    readonly addressId: string;
    readonly expectedVersion: number;
    readonly options: Readonly<Record<string, boolean | string>>;
  },
): Promise<GiftOrder> {
  return apiRequest(`/api/v1/me/gifts/${giftOrderId}/submit`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function getCreatorReleases(): Promise<readonly GiftRelease[]> {
  return apiRequest('/api/v1/creator/releases');
}

export function getCreatorRelease(releaseId: string): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}`);
}

export function createCreatorRelease(input: ReleaseInput): Promise<GiftRelease> {
  return apiRequest('/api/v1/creator/releases', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateCreatorRelease(releaseId: string, input: ReleaseInput): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}`, {
    body: JSON.stringify(input),
    method: 'PUT',
  });
}

export function publishCreatorRelease(releaseId: string): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}/publish`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function closeCreatorRelease(releaseId: string): Promise<GiftRelease> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}/close`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function deleteCreatorRelease(releaseId: string): Promise<void> {
  return apiRequest(`/api/v1/creator/releases/${releaseId}`, { method: 'DELETE' });
}

export function uploadCreatorReleaseCover(
  releaseId: string,
  file: File,
): Promise<{ readonly coverImageUrl: string }> {
  const body = new FormData();
  body.append('file', file);
  return apiRequest(`/api/v1/creator/releases/${releaseId}/cover`, {
    body,
    method: 'POST',
  });
}

export function getCreatorOrders(status?: GiftOrderStatus): Promise<readonly GiftOrder[]> {
  return apiRequest(`/api/v1/creator/orders${status ? `?status=${status}` : ''}`);
}

export function getCreatorOrder(giftOrderId: string): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}`);
}

export function processCreatorOrder(giftOrderId: string): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}/process`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function shipCreatorOrder(
  giftOrderId: string,
  input: {
    readonly carrierCode: string;
    readonly carrierName: string;
    readonly trackingNumber: string;
    readonly trackingUrl?: null | string;
  },
): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}/ship`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function completeCreatorOrder(giftOrderId: string): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}/complete`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function cancelCreatorOrder(giftOrderId: string, reason: string): Promise<CreatorOrder> {
  return apiRequest(`/api/v1/creator/orders/${giftOrderId}/cancel`, {
    body: JSON.stringify({ reason }),
    method: 'POST',
  });
}

export function getCreatorRosters(): Promise<readonly SnapshotRun[]> {
  return apiRequest('/api/v1/creator/rosters');
}

export function updateCreatorProfile(input: {
  readonly displayName?: string;
}): Promise<Identity['creator']> {
  return apiRequest('/api/v1/creator/profile', {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export interface ManagedAnnouncementInput {
  readonly body: string;
  readonly expiresAt?: null | string;
  readonly pinned: boolean;
  readonly publishNow: boolean;
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
  readonly title: string;
}

export function getManagedAnnouncements(
  area: 'admin' | 'creator',
): Promise<readonly Announcement[]> {
  return apiRequest(`/api/v1/${area}/announcements`);
}

export function createManagedAnnouncement(
  area: 'admin' | 'creator',
  input: ManagedAnnouncementInput,
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
  input: ManagedAnnouncementInput & { readonly expectedVersion: number },
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}`, {
    body: JSON.stringify(input),
    method: 'PUT',
  });
}

export function deleteManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
): Promise<void> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}`, {
    method: 'DELETE',
  });
}

export function getAdminOverview(): Promise<{
  readonly activeCreators: number;
  readonly creators: number;
  readonly recent: readonly {
    readonly active: boolean;
    readonly displayName: string;
    readonly id: string;
    readonly updatedAt: string;
  }[];
}> {
  return apiRequest('/api/v1/admin/overview');
}

export function getAdminUsers(search = ''): Promise<readonly UserRecord[]> {
  return apiRequest(`/api/v1/admin/users?search=${encodeURIComponent(search)}`);
}

export function getAdminCreators(): Promise<readonly CreatorRecord[]> {
  return apiRequest('/api/v1/admin/creators');
}

export function createAdminCreator(input: {
  readonly bilibiliUid: string;
  readonly displayName: string;
  readonly roomId: string;
  readonly timezone: string;
  readonly userId: string;
}): Promise<CreatorRecord> {
  return apiRequest('/api/v1/admin/creators', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateAdminCreator(
  creatorId: string,
  input: {
    readonly active?: boolean;
    readonly bilibiliUid?: string;
    readonly displayName?: string;
    readonly roomId?: string;
    readonly timezone?: string;
  },
): Promise<CreatorRecord> {
  return apiRequest(`/api/v1/admin/creators/${creatorId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function getAdminRosters(): Promise<readonly AdminSnapshot[]> {
  return apiRequest('/api/v1/admin/rosters');
}

export function getAdminRoster(snapshotRunId: string): Promise<{
  readonly attempts: readonly {
    readonly attemptNumber: number;
    readonly captureCompletedAt: null | string;
    readonly consistencyStatus: string;
    readonly declaredTotal: null | number;
    readonly failureCode: null | string;
    readonly failureMessage: null | string;
    readonly normalizedTotal: null | number;
    readonly punctuality: null | string;
  }[];
  readonly pages: readonly {
    readonly contentHashSha256: string;
    readonly itemCount: number;
    readonly pageNumber: number;
  }[];
  readonly run: SnapshotRun;
}> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}`);
}

export function retryAdminRoster(snapshotRunId: string): Promise<unknown> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/retry`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function approveAdminRoster(snapshotRunId: string): Promise<void> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/approve-late`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function rejectAdminRoster(snapshotRunId: string, reason: string): Promise<void> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/reject-late`, {
    body: JSON.stringify({ reason }),
    method: 'POST',
  });
}

export function getVerificationRooms(): Promise<readonly VerificationRoom[]> {
  return apiRequest('/api/v1/admin/verification-rooms');
}

export function createVerificationRoom(input: {
  readonly biliOwnerUid: string;
  readonly biliRoomId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly priority: number;
}): Promise<VerificationRoom> {
  return apiRequest('/api/v1/admin/verification-rooms', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateVerificationRoom(
  roomId: string,
  input: {
    readonly biliOwnerUid?: string;
    readonly displayName?: string;
    readonly enabled?: boolean;
    readonly priority?: number;
  },
): Promise<VerificationRoom> {
  return apiRequest(`/api/v1/admin/verification-rooms/${roomId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function testVerificationRoom(roomId: string): Promise<VerificationRoom> {
  return apiRequest(`/api/v1/admin/verification-rooms/${roomId}/test`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function getAdminSystem(): Promise<Record<string, unknown>> {
  return apiRequest('/api/v1/admin/system');
}

export function getAdminAuditLogs(): Promise<{
  readonly items: readonly {
    readonly action: string;
    readonly actorUserId: null | string;
    readonly createdAt: string;
    readonly id: string;
    readonly targetType: string;
  }[];
  readonly nextBefore: null | string;
}> {
  return apiRequest('/api/v1/admin/audit-logs?limit=20');
}
