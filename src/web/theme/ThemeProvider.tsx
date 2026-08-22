import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { isUiTheme, type UiTheme } from '../../shared/ui-theme';
import { getPublicTheme } from '../api/appearance';
import { ThemeContext } from './context';

const themeColors: Readonly<Record<UiTheme, string>> = {
  archive: '#f5eddd',
  moe: '#fff5f8',
  neon: '#080b14',
  pixel: '#100b24',
};

function initialTheme(): UiTheme {
  const serverTheme = document.documentElement.dataset.uiTheme;
  return isUiTheme(serverTheme) ? serverTheme : 'archive';
}

function applyTheme(theme: UiTheme): void {
  document.documentElement.dataset.uiTheme = theme;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = themeColors[theme];
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setThemeState] = useState<UiTheme>(initialTheme);
  const setTheme = useCallback((nextTheme: UiTheme) => {
    applyTheme(nextTheme);
    setThemeState(nextTheme);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    void getPublicTheme()
      .then(({ theme: serverTheme }) => {
        if (active) setTheme(serverTheme);
      })
      .catch(() => {
        // The deployment default remains active if the public setting cannot be loaded.
      });
    return () => {
      active = false;
    };
  }, [setTheme]);

  const value = useMemo(() => ({ setTheme, theme }), [setTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
