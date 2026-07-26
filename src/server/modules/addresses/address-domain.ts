import { AppError } from '../../../shared/errors/app-error.js';

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

const limits: Readonly<Record<keyof AddressPayload, number>> = {
  city: 100,
  countryRegion: 100,
  detailedAddress: 500,
  district: 100,
  phone: 40,
  postalCode: 20,
  province: 100,
  recipientName: 100,
  userNote: 500,
};

export function normalizeAddressPayload(input: AddressPayload): AddressPayload {
  const normalized = Object.fromEntries(
    (Object.keys(limits) as (keyof AddressPayload)[]).map((key) => [key, input[key].trim()]),
  ) as unknown as AddressPayload;
  for (const [key, maximum] of Object.entries(limits) as [keyof AddressPayload, number][]) {
    if (typeof normalized[key] !== 'string' || normalized[key].length > maximum) {
      throw new AppError('ADDRESS_INVALID', `Address field ${key} is invalid.`, 400);
    }
  }
  for (const key of [
    'recipientName',
    'phone',
    'countryRegion',
    'province',
    'city',
    'detailedAddress',
  ] as const) {
    if (!normalized[key]) {
      throw new AppError('ADDRESS_INVALID', `Address field ${key} is required.`, 400);
    }
  }
  if (!/^[+0-9 ()-]{5,40}$/.test(normalized.phone)) {
    throw new AppError('ADDRESS_INVALID', 'Address phone format is invalid.', 400);
  }
  return normalized;
}

export function isAddressPayload(value: unknown): value is AddressPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(limits).every((key) => typeof candidate[key] === 'string');
}
