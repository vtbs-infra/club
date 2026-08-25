import {
  THEME_PRESETS,
  type Appearance,
  type ThemePreset,
} from '../../shared/contracts/appearance';
import { apiRequest } from './http';

export type { Appearance, ThemePreset } from '../../shared/contracts/appearance';

export const appearanceQueryKey = ['appearance'] as const;

function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && (THEME_PRESETS as readonly string[]).includes(value);
}

function parseAppearance(value: Appearance): Appearance {
  if (!isThemePreset(value.themePreset)) {
    throw new Error('The server returned an unsupported application theme.');
  }
  return value;
}

export async function getAppearance(): Promise<Appearance> {
  return parseAppearance(await apiRequest<Appearance>('/api/v1/appearance'));
}

export async function updateAppearance(themePreset: ThemePreset): Promise<Appearance> {
  return parseAppearance(
    await apiRequest<Appearance>('/api/v1/admin/appearance', {
      body: JSON.stringify({ themePreset }),
      method: 'PUT',
    }),
  );
}
