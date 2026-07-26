import { apiRequest } from './http';

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

export const getAddresses = () => apiRequest<AddressRecord[]>('/api/v1/me/addresses');

export const createAddress = (input: {
  readonly isDefault: boolean;
  readonly label: string;
  readonly payload: AddressPayload;
}) =>
  apiRequest<AddressRecord>('/api/v1/me/addresses', {
    body: JSON.stringify(input),
    method: 'POST',
  });

export const updateAddress = (
  addressId: string,
  input: { readonly isDefault: boolean; readonly label: string; readonly payload: AddressPayload },
) =>
  apiRequest<AddressRecord>(`/api/v1/me/addresses/${addressId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });

export const deleteAddress = (addressId: string) =>
  apiRequest<void>(`/api/v1/me/addresses/${addressId}`, { method: 'DELETE' });
