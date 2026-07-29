import { createContext, useContext } from 'react';

export type Language = 'en' | 'zh-CN';

export interface I18nContextValue {
  readonly language: Language;
  readonly setLanguage: (language: Language) => void;
  readonly t: (chinese: string, english?: string) => string;
  readonly toggleLanguage: () => void;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider.');
  return context;
}
