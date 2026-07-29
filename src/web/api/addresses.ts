import type { AddressPayloadContract, AddressRecord } from '../../shared/contracts/addresses';
import { apiRequest } from './http';

export type AddressPayload = AddressPayloadContract;
export type { AddressRecord };

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
