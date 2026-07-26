import { createContext, useContext } from 'react';

import type { UiTheme } from '../../shared/ui-theme';

export interface ThemeContextValue {
  readonly setTheme: (theme: UiTheme) => void;
  readonly theme: UiTheme;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider.');
  return context;
}
