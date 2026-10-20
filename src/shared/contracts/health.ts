import { Type, type Static } from 'typebox';

export const HealthStatusSchema = Type.Union([Type.Literal('ok'), Type.Literal('not_ready')]);

export const LivenessResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  now: Type.String({ format: 'date-time' }),
  version: Type.String(),
});

export const ReadinessResponseSchema = Type.Object({
  status: HealthStatusSchema,
  checks: Type.Object({
    database: Type.Union([Type.Literal('ok'), Type.Literal('down')]),
    runtimes: Type.Union([Type.Literal('ok'), Type.Literal('down'), Type.Literal('disabled')]),
    schema: Type.Union([Type.Literal('ok'), Type.Literal('down')]),
    storage: Type.Union([Type.Literal('ok'), Type.Literal('down')]),
  }),
});
export type ReadinessResponse = Static<typeof ReadinessResponseSchema>;
