import { Type, type Static, type TSchema } from 'typebox';

export const IdSchema = Type.String({ format: 'uuid' });
export const DateTimeSchema = Type.String({ format: 'date-time' });
// Wall-clock time as a person entered it. Inputs send it with the IANA time zone the form showed,
// and the server converts the pair to an instant.
export const LocalDateTimeSchema = Type.String({
  pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d$',
});
export const TimeZoneSchema = Type.String({ maxLength: 100, minLength: 1 });
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
