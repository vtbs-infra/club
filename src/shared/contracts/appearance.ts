import { Type, type Static } from '@sinclair/typebox';

export const THEME_PRESETS = ['moe', 'neon', 'archive', 'pixel'] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

export const ThemePresetSchema = Type.Union(THEME_PRESETS.map((preset) => Type.Literal(preset)));

export const AppearanceSchema = Type.Object({
  themePreset: ThemePresetSchema,
});
export type Appearance = Static<typeof AppearanceSchema>;

export const UpdateAppearanceSchema = Type.Object(
  {
    themePreset: ThemePresetSchema,
  },
  { additionalProperties: false },
);
export type UpdateAppearance = Static<typeof UpdateAppearanceSchema>;
