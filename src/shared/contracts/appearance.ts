import { Type, type Static } from 'typebox';

import { THEME_PRESETS } from '../theme-presets.js';

export type { ThemePreset } from '../theme-presets.js';

export const ThemePresetSchema = Type.Enum(THEME_PRESETS);

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
