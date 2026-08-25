import { useQuery } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import { appearanceQueryKey, getAppearance } from '../api/appearance';
import type { ThemePreset } from '../../shared/contracts/appearance';
import { AppearanceContext, type AppearanceContextValue } from './context';
import { THEME_DEFINITIONS } from './definitions';

const DEFAULT_THEME: ThemePreset = 'moe';

export function AppearanceProvider({ children }: { readonly children: ReactNode }) {
  const appearance = useQuery({
    gcTime: Infinity,
    queryFn: getAppearance,
    queryKey: appearanceQueryKey,
    refetchOnMount: false,
    retry: false,
    staleTime: Infinity,
  });
  const [appliedThemeOverride, setAppliedThemeOverride] = useState<ThemePreset | null>(null);
  const [previewTheme, setPreviewThemeState] = useState<ThemePreset | null>(null);
  const appliedTheme = appliedThemeOverride ?? appearance.data?.themePreset ?? DEFAULT_THEME;

  const setPreviewTheme = useCallback((theme: ThemePreset) => {
    setPreviewThemeState(theme);
  }, []);
  const cancelPreview = useCallback(() => {
    setPreviewThemeState(null);
  }, []);
  const acceptAppliedTheme = useCallback((theme: ThemePreset) => {
    setAppliedThemeOverride(theme);
    setPreviewThemeState(null);
  }, []);
  const renderedTheme = previewTheme ?? appliedTheme;

  useLayoutEffect(() => {
    document.documentElement.dataset.appTheme = renderedTheme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = THEME_DEFINITIONS[renderedTheme].themeColor;
  }, [renderedTheme]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      acceptAppliedTheme,
      appliedTheme,
      cancelPreview,
      loadError: appearance.error ?? null,
      previewTheme,
      renderedTheme,
      setPreviewTheme,
    }),
    [
      acceptAppliedTheme,
      appliedTheme,
      appearance.error,
      cancelPreview,
      previewTheme,
      renderedTheme,
      setPreviewTheme,
    ],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
