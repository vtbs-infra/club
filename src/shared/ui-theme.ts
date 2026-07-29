export const UI_THEMES = ['moe', 'neon', 'archive', 'pixel'] as const;

export type UiTheme = (typeof UI_THEMES)[number];

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === 'string' && UI_THEMES.includes(value as UiTheme);
}
