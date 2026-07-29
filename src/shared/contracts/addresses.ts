import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema } from './common.js';

export const AddressPayloadSchema = Type.Object(
  {
    city: Type.String({ maxLength: 100 }),
    countryRegion: Type.String({ maxLength: 100 }),
    detailedAddress: Type.String({ maxLength: 500 }),
    district: Type.String({ maxLength: 100 }),
    phone: Type.String({ maxLength: 40 }),
    postalCode: Type.String({ maxLength: 20 }),
    province: Type.String({ maxLength: 100 }),
    recipientName: Type.String({ maxLength: 100 }),
    userNote: Type.String({ maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type AddressPayloadContract = Static<typeof AddressPayloadSchema>;

export const AddressInputSchema = Type.Object(
  {
    isDefault: Type.Boolean(),
    label: Type.String({ maxLength: 80, minLength: 1 }),
    payload: AddressPayloadSchema,
  },
  { additionalProperties: false },
);
export type AddressInputContract = Static<typeof AddressInputSchema>;

export const AddressUpdateSchema = Type.Partial(AddressInputSchema, {
  additionalProperties: false,
  minProperties: 1,
});

export const AddressRecordSchema = Type.Object({
  createdAt: DateTimeSchema,
  id: IdSchema,
  isDefault: Type.Boolean(),
  label: Type.String(),
  payload: AddressPayloadSchema,
  updatedAt: DateTimeSchema,
});
export type AddressRecord = Static<typeof AddressRecordSchema>;
