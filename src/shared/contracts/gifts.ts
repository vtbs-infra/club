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

export const ShipmentProgressSchema = Type.Union([
  Type.Literal('LABEL_CREATED'),
  Type.Literal('IN_TRANSIT'),
  Type.Literal('OUT_FOR_DELIVERY'),
  Type.Literal('DELIVERED'),
]);
export type ShipmentProgress = Static<typeof ShipmentProgressSchema>;

export const TrackingEventStatusSchema = Type.Union([
  Type.Literal('LABEL_CREATED'),
  Type.Literal('IN_TRANSIT'),
  Type.Literal('OUT_FOR_DELIVERY'),
  Type.Literal('DELIVERED'),
  Type.Literal('EXCEPTION'),
]);
export type TrackingEventStatus = Static<typeof TrackingEventStatusSchema>;

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
  coverImageUrl: Nullable(Type.String()),
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

export const GiftReleaseSummarySchema = Type.Pick(GiftReleaseSchema, [
  'claimDeadlineAt',
  'claimStartAt',
  'closedAt',
  'coverImageUrl',
  'createdAt',
  'eligibilityMonth',
  'id',
  'publicVisible',
  'publishedAt',
  'status',
  'title',
  'updatedAt',
  'version',
]);
export type GiftReleaseSummary = Static<typeof GiftReleaseSummarySchema>;

export const GiftReleaseSummaryPageSchema = Type.Object({
  items: Type.Array(GiftReleaseSummarySchema),
  nextCursor: Nullable(Type.String()),
});
export type GiftReleaseSummaryPage = Static<typeof GiftReleaseSummaryPageSchema>;

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
      status: TrackingEventStatusSchema,
    }),
  ),
  exceptionMessage: Nullable(Type.String()),
  id: IdSchema,
  progress: ShipmentProgressSchema,
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

export const GiftOrderListFilterSchema = Type.Union([
  Type.Literal('ALL'),
  Type.Literal('CLAIMABLE'),
  Type.Literal('SUBMITTED'),
  Type.Literal('SHIPPED'),
  Type.Literal('COMPLETED'),
  Type.Literal('ENDED'),
]);
export type GiftOrderListFilter = Static<typeof GiftOrderListFilterSchema>;

export const GiftOrderSummarySchema = Type.Object({
  biliDisplayName: Nullable(Type.String()),
  biliUid: Type.String(),
  creator: Type.Object({
    displayName: Type.String(),
    id: IdSchema,
  }),
  expiresAt: DateTimeSchema,
  id: IdSchema,
  orderNumber: Type.String(),
  release: Type.Object({
    claimDeadlineAt: DateTimeSchema,
    claimStartAt: DateTimeSchema,
    coverImageUrl: Nullable(Type.String()),
    eligibilityMonth: Type.String({ format: 'date' }),
    id: IdSchema,
    title: Type.String(),
  }),
  shipment: Nullable(
    Type.Object({
      carrierName: Type.String(),
      exceptionMessage: Nullable(Type.String()),
      progress: ShipmentProgressSchema,
    }),
  ),
  status: GiftOrderStatusSchema,
  tier: GuardTierSchema,
  updatedAt: DateTimeSchema,
});
export type GiftOrderSummary = Static<typeof GiftOrderSummarySchema>;

export const GiftOrderSummaryPageSchema = Type.Object({
  items: Type.Array(GiftOrderSummarySchema),
  nextCursor: Nullable(Type.String()),
});
export type GiftOrderSummaryPage = Static<typeof GiftOrderSummaryPageSchema>;

const GiftOrderStatusCountsSchema = Type.Object({
  cancelled: Type.Integer({ minimum: 0 }),
  claimable: Type.Integer({ minimum: 0 }),
  completed: Type.Integer({ minimum: 0 }),
  expired: Type.Integer({ minimum: 0 }),
  shipped: Type.Integer({ minimum: 0 }),
  submitted: Type.Integer({ minimum: 0 }),
});

export const CreatorOrderOverviewSchema = Type.Object({
  activeRelease: Nullable(
    Type.Object({
      counts: GiftOrderStatusCountsSchema,
      eligibilityMonth: Type.String({ format: 'date' }),
      id: IdSchema,
      title: Type.String(),
    }),
  ),
  counts: GiftOrderStatusCountsSchema,
  releaseCount: Type.Integer({ minimum: 0 }),
});
export type CreatorOrderOverview = Static<typeof CreatorOrderOverviewSchema>;

export const FulfillmentReleaseSummarySchema = Type.Object({
  claimDeadlineAt: DateTimeSchema,
  eligibilityMonth: Type.String({ format: 'date' }),
  id: IdSchema,
  submittedCount: Type.Integer({ minimum: 1 }),
  title: Type.String(),
});

export const FulfillmentReleaseSummaryPageSchema = Type.Object({
  items: Type.Array(FulfillmentReleaseSummarySchema),
  nextCursor: Nullable(Type.String()),
});
export type FulfillmentReleaseSummaryPage = Static<typeof FulfillmentReleaseSummaryPageSchema>;

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
