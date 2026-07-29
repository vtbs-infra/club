import { Type, type Static, type TSchema } from '@sinclair/typebox';

export const IdSchema = Type.String({ format: 'uuid' });
export const DateTimeSchema = Type.String({ format: 'date-time' });
export const CalendarMonthSchema = Type.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])-01$' });

export function Nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

export const AccountRoleSchema = Type.Union([
  Type.Literal('USER'),
  Type.Literal('CREATOR'),
  Type.Literal('PLATFORM_ADMIN'),
]);
export type AccountRole = Static<typeof AccountRoleSchema>;

export const GuardTierSchema = Type.Union([
  Type.Literal('CAPTAIN'),
  Type.Literal('ADMIRAL'),
  Type.Literal('GOVERNOR'),
]);
export type GuardTier = Static<typeof GuardTierSchema>;

export const EmptyBodySchema = Type.Object({}, { additionalProperties: false });
