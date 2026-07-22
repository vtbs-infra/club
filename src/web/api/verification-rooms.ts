import { apiRequest } from './http';

export interface VerificationRoom {
  readonly biliOwnerUid: string;
  readonly biliRoomId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly healthStatus: 'UNKNOWN' | 'CONNECTING' | 'HEALTHY' | 'UNHEALTHY';
  readonly id: string;
  readonly lastConnectedAt: string | null;
  readonly priority: number;
}

export interface CreateVerificationRoomInput {
  readonly biliOwnerUid: string;
  readonly biliRoomId: string;
  readonly displayName: string;
  readonly enabled?: boolean;
  readonly priority?: number;
}

export function listVerificationRooms(): Promise<readonly VerificationRoom[]> {
  return apiRequest('/api/v1/platform/verification-rooms');
}

export function createVerificationRoom(
  input: CreateVerificationRoomInput,
): Promise<VerificationRoom> {
  return apiRequest('/api/v1/platform/verification-rooms', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateVerificationRoom(
  roomId: string,
  input: Partial<Pick<VerificationRoom, 'biliOwnerUid' | 'displayName' | 'enabled' | 'priority'>>,
): Promise<VerificationRoom> {
  return apiRequest(`/api/v1/platform/verification-rooms/${roomId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function testVerificationRoom(roomId: string): Promise<VerificationRoom> {
  return apiRequest(`/api/v1/platform/verification-rooms/${roomId}/test`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}
