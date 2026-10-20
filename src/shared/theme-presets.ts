// The browser imports these values at runtime, so this module must not depend on TypeBox.
export const THEME_PRESETS = ['moe', 'neon', 'archive', 'pixel'] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];
