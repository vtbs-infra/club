import { createContext, useContext } from 'react';

import type { ThemePreset } from '../../shared/contracts/appearance';

export interface AppearanceContextValue {
  readonly acceptAppliedTheme: (theme: ThemePreset) => void;
  readonly appliedTheme: ThemePreset;
  readonly cancelPreview: () => void;
  readonly loadError: unknown;
  readonly previewTheme: ThemePreset | null;
  readonly renderedTheme: ThemePreset;
  readonly setPreviewTheme: (theme: ThemePreset) => void;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used within AppearanceProvider.');
  return value;
}
