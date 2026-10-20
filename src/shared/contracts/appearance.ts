import { Type, type Static } from '@sinclair/typebox';

import { THEME_PRESETS } from '../theme-presets.js';

export type { ThemePreset } from '../theme-presets.js';

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
