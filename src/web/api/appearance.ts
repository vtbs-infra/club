import type { UiTheme } from '../../shared/ui-theme';
import { apiRequest } from './http';

export interface AppearanceState {
  readonly activeTheme: UiTheme;
  readonly deploymentTheme: UiTheme;
  readonly overrideTheme: UiTheme | null;
  readonly updatedAt: string | null;
  readonly updatedByUserId: string | null;
  readonly version: number;
}

export function getPublicTheme(): Promise<{ readonly theme: UiTheme }> {
  return apiRequest('/api/v1/ui-theme');
}

export function getAppearance(): Promise<AppearanceState> {
  return apiRequest('/api/v1/platform/appearance');
}

export function updateAppearance(
  theme: UiTheme,
  expectedVersion: number,
): Promise<AppearanceState> {
  return apiRequest('/api/v1/platform/appearance', {
    body: JSON.stringify({ expectedVersion, theme }),
    method: 'PUT',
  });
}

export function restoreAppearance(expectedVersion: number): Promise<AppearanceState> {
  return apiRequest('/api/v1/platform/appearance/restore', {
    body: JSON.stringify({ expectedVersion }),
    method: 'POST',
  });
}
