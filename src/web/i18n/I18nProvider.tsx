import { type ReactNode, useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { I18nContext, type Language } from './context';
import { englishToChinese } from './translations';

const storageKey = 'club-language';
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();

function initialLanguage(): Language {
  try {
    return window.localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

function chineseValue(value: string): string {
  const whitespace = /^(\s*)(.*?)(\s*)$/s.exec(value);
  if (!whitespace) return value;
  const [, leading, content, trailing] = whitespace;
  if (!content) return value;
  const translated = englishToChinese[content];
  return translated === undefined ? value : `${leading}${translated}${trailing}`;
}

function translateNode(node: Node, language: Language): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    if (language === 'en') {
      const original = originalText.get(text);
      if (original !== undefined && original !== text.data) text.data = original;
      return;
    }
    const translated = chineseValue(text.data);
    if (translated !== text.data) {
      originalText.set(text, text.data);
      text.data = translated;
    }
    return;
  }
  if (!(node instanceof Element)) return;
  for (const attribute of ['aria-label', 'placeholder', 'title'] as const) {
    const value = node.getAttribute(attribute);
    if (!value) continue;
    if (language === 'en') {
      const original = originalAttributes.get(node)?.get(attribute);
      if (original !== undefined && original !== value) node.setAttribute(attribute, original);
      continue;
    }
    const translated = chineseValue(value);
    if (translated !== value) {
      const attributes = originalAttributes.get(node) ?? new Map<string, string>();
      attributes.set(attribute, value);
      originalAttributes.set(node, attributes);
      node.setAttribute(attribute, translated);
    }
  }
  for (const child of node.childNodes) translateNode(child, language);
}

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    try {
      window.localStorage.setItem(storageKey, nextLanguage);
    } catch {
      // Language switching must still work when persistent storage is blocked.
    }
  }, []);
  const toggleLanguage = useCallback(
    () => setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN'),
    [language, setLanguage],
  );

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    const root = document.querySelector('#root');
    if (!root) return undefined;
    translateNode(root, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'attributes') {
          translateNode(mutation.target, language);
        }
        for (const node of mutation.addedNodes) translateNode(node, language);
      }
    });
    observer.observe(root, {
      attributeFilter: ['aria-label', 'placeholder', 'title'],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage }),
    [language, setLanguage, toggleLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
