import { Type, type Static } from '@sinclair/typebox';

import { AddressPayloadSchema } from './addresses.js';
import {
  CalendarMonthSchema,
  DateTimeSchema,
  GuardTierSchema,
  IdSchema,
  Nullable,
} from './common.js';

export const GiftOrderStatusSchema = Type.Union([
  Type.Literal('CLAIMABLE'),
  Type.Literal('SUBMITTED'),
  Type.Literal('SHIPPED'),
  Type.Literal('COMPLETED'),
  Type.Literal('EXPIRED'),
  Type.Literal('CANCELLED'),
]);
export type GiftOrderStatus = Static<typeof GiftOrderStatusSchema>;

export const ShipmentStatusSchema = Type.Union([
  Type.Literal('LABEL_CREATED'),
  Type.Literal('IN_TRANSIT'),
  Type.Literal('OUT_FOR_DELIVERY'),
  Type.Literal('DELIVERED'),
  Type.Literal('EXCEPTION'),
]);
export type ShipmentStatus = Static<typeof ShipmentStatusSchema>;

export const GiftFormFieldTypeSchema = Type.Union([
  Type.Literal('TEXT'),
  Type.Literal('TEXTAREA'),
  Type.Literal('SELECT'),
  Type.Literal('RADIO'),
  Type.Literal('CHECKBOX'),
]);

export const GiftFormFieldSchema = Type.Object(
  {
    key: Type.String({ maxLength: 40, minLength: 1 }),
    label: Type.String({ maxLength: 120, minLength: 1 }),
    options: Type.Optional(
      Type.Array(Type.String({ maxLength: 120, minLength: 1 }), { maxItems: 30 }),
    ),
    required: Type.Boolean(),
    type: GiftFormFieldTypeSchema,
  },
  { additionalProperties: false },
);
export type GiftFormField = Static<typeof GiftFormFieldSchema>;

export const ReleasePackageInputSchema = Type.Object(
  {
    description: Type.String({ maxLength: 2_000 }),
    items: Type.Array(
      Type.Object(
        {
          description: Type.String({ maxLength: 1_000 }),
          name: Type.String({ maxLength: 120, minLength: 1 }),
          quantity: Type.Integer({ maximum: 999, minimum: 1 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 30 },
    ),
    name: Type.String({ maxLength: 120, minLength: 1 }),
  },
  { additionalProperties: false },
);
export type ReleasePackageInput = Static<typeof ReleasePackageInputSchema>;

export const ReleaseInputSchema = Type.Object(
  {
    claimDeadlineAt: DateTimeSchema,
    claimStartAt: DateTimeSchema,
    description: Type.String({ maxLength: 5_000 }),
    eligibilityMonth: CalendarMonthSchema,
    formFields: Type.Array(GiftFormFieldSchema, { maxItems: 20 }),
    fulfillmentMode: Type.Union([Type.Literal('HIGHEST_ONLY'), Type.Literal('CUMULATIVE')]),
    packages: Type.Array(ReleasePackageInputSchema, { maxItems: 12, minItems: 1 }),
    publicVisible: Type.Boolean(),
    tierPackageIndexes: Type.Object(
      {
        ADMIRAL: Type.Integer({ minimum: 0 }),
        CAPTAIN: Type.Integer({ minimum: 0 }),
        GOVERNOR: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    title: Type.String({ maxLength: 160, minLength: 1 }),
  },
  { additionalProperties: false },
);
export type ReleaseInput = Static<typeof ReleaseInputSchema>;

export const ReleaseUpdateInputSchema = Type.Composite([
  ReleaseInputSchema,
  Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }) }),
]);
export type ReleaseUpdateInput = Static<typeof ReleaseUpdateInputSchema>;

export const ReleasePublishInputSchema = Type.Composite([
  ReleaseInputSchema,
  Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }) }),
]);
export type ReleasePublishInput = Static<typeof ReleasePublishInputSchema>;

const ReleasePackageSchema = Type.Object({
  description: Type.String(),
  id: IdSchema,
  items: Type.Array(
    Type.Object({
      description: Type.String(),
      name: Type.String(),
      quantity: Type.Integer({ minimum: 1 }),
    }),
  ),
  name: Type.String(),
});

export const GiftReleaseSchema = Type.Object({
  claimDeadlineAt: DateTimeSchema,
  claimStartAt: DateTimeSchema,
  closedAt: Nullable(DateTimeSchema),
  coverObjectKey: Nullable(Type.String()),
  createdAt: DateTimeSchema,
  description: Type.String(),
  eligibilityMonth: Type.String({ format: 'date' }),
  formFields: Type.Optional(Type.Array(GiftFormFieldSchema)),
  fulfillmentMode: Type.Union([Type.Literal('HIGHEST_ONLY'), Type.Literal('CUMULATIVE')]),
  id: IdSchema,
  packages: Type.Optional(Type.Array(ReleasePackageSchema)),
  publicVisible: Type.Boolean(),
  publishedAt: Nullable(DateTimeSchema),
  status: Type.Union([Type.Literal('DRAFT'), Type.Literal('PUBLISHED'), Type.Literal('CLOSED')]),
  tierPackageIndexes: Type.Optional(
    Type.Partial(
      Type.Object({
        ADMIRAL: Type.Integer({ minimum: 0 }),
        CAPTAIN: Type.Integer({ minimum: 0 }),
        GOVERNOR: Type.Integer({ minimum: 0 }),
      }),
    ),
  ),
  title: Type.String(),
  updatedAt: DateTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type GiftRelease = Static<typeof GiftReleaseSchema>;

const GiftOrderItemSchema = Type.Object({
  description: Type.String(),
  id: IdSchema,
  items: Type.Array(
    Type.Object({
      description: Type.String(),
      name: Type.String(),
      quantity: Type.Integer({ minimum: 1 }),
    }),
  ),
  name: Type.String(),
});

const ShipmentSchema = Type.Object({
  carrierName: Type.String(),
  createdAt: DateTimeSchema,
  events: Type.Array(
    Type.Object({
      description: Type.String(),
      location: Nullable(Type.String()),
      occurredAt: DateTimeSchema,
      status: ShipmentStatusSchema,
    }),
  ),
  id: IdSchema,
  status: ShipmentStatusSchema,
  trackingNumber: Type.String(),
  trackingUrl: Nullable(Type.String()),
});

export const GiftOrderSchema = Type.Object({
  biliDisplayName: Nullable(Type.String()),
  biliUid: Type.String(),
  cancelledAt: Nullable(DateTimeSchema),
  completedAt: Nullable(DateTimeSchema),
  creator: Type.Object({
    displayName: Type.String(),
    id: IdSchema,
  }),
  expiresAt: DateTimeSchema,
  id: IdSchema,
  items: Type.Array(GiftOrderItemSchema),
  orderNumber: Type.String(),
  release: Type.Object({
    claimDeadlineAt: DateTimeSchema,
    claimStartAt: DateTimeSchema,
    coverImageUrl: Nullable(Type.String()),
    description: Type.String(),
    eligibilityMonth: Type.String({ format: 'date' }),
    formFields: Type.Array(GiftFormFieldSchema),
    id: IdSchema,
    title: Type.String(),
  }),
  shipments: Type.Array(ShipmentSchema),
  shippedAt: Nullable(DateTimeSchema),
  status: GiftOrderStatusSchema,
  submittedAt: Nullable(DateTimeSchema),
  tier: GuardTierSchema,
  updatedAt: DateTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type GiftOrder = Static<typeof GiftOrderSchema>;

export const CreatorOrderSchema = Type.Object({
  ...GiftOrderSchema.properties,
  deliveryAddress: Nullable(AddressPayloadSchema),
  optionValues: Type.Array(
    Type.Object({
      key: Type.String(),
      label: Type.String(),
      value: Type.Union([Type.Boolean(), Type.String()]),
    }),
  ),
});
export type CreatorOrder = Static<typeof CreatorOrderSchema>;

export const SubmitGiftSchema = Type.Object(
  {
    addressId: IdSchema,
    expectedVersion: Type.Integer({ minimum: 1 }),
    options: Type.Record(
      Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }),
      Type.Union([Type.Boolean(), Type.String({ maxLength: 2_000 })]),
    ),
  },
  { additionalProperties: false },
);

export const ShipGiftSchema = Type.Object(
  {
    carrierCode: Type.String({ maxLength: 80, minLength: 1 }),
    carrierName: Type.String({ maxLength: 120, minLength: 1 }),
    trackingNumber: Type.String({ maxLength: 160, minLength: 1 }),
    trackingUrl: Type.Optional(Nullable(Type.String({ maxLength: 1_000, pattern: '^https?://' }))),
  },
  { additionalProperties: false },
);

export const FulfillmentExportInputSchema = Type.Object(
  { releaseId: IdSchema },
  { additionalProperties: false },
);
