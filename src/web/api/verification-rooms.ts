import type {
  VerificationRoom,
  VerificationRoomInput,
  VerificationRoomUpdate,
} from '../../shared/contracts/verification-rooms';
import { apiRequest } from './http';

export type { VerificationRoom };

export function getVerificationRooms(): Promise<readonly VerificationRoom[]> {
  return apiRequest('/api/v1/admin/verification-rooms');
}

export function createVerificationRoom(input: VerificationRoomInput): Promise<VerificationRoom> {
  return apiRequest('/api/v1/admin/verification-rooms', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateVerificationRoom(
  roomId: string,
  input: VerificationRoomUpdate,
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
