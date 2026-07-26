import { type ReactNode, useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { I18nContext, type Language } from './context';
import { englishToChinese } from './translations';

const storageKey = 'club-language';
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const chineseToEnglish: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(englishToChinese).map(([english, chinese]) => [chinese, english]),
  ),
  公告: 'Announcements',
  我的: 'My account',
  礼物: 'Gifts',
  登录: 'Sign in',
  舰长礼物计划: 'Captain Gift Program',
  首页: 'Home',
};

function initialLanguage(): Language {
  try {
    return window.localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

function localizedValue(value: string, language: Language): string {
  const whitespace = /^(\s*)(.*?)(\s*)$/s.exec(value);
  if (!whitespace) return value;
  const [, leading, content, trailing] = whitespace;
  if (!content) return value;
  const translated = language === 'zh-CN' ? englishToChinese[content] : chineseToEnglish[content];
  return translated === undefined ? value : `${leading}${translated}${trailing}`;
}

function translateNode(node: Node, language: Language): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    let source = originalText.get(text) ?? text.data;
    const knownValues = new Set([
      source,
      localizedValue(source, 'en'),
      localizedValue(source, 'zh-CN'),
    ]);
    if (!knownValues.has(text.data)) {
      source = text.data;
      originalText.set(text, source);
    }
    const translated = localizedValue(source, language);
    if (translated !== text.data) {
      if (!originalText.has(text)) originalText.set(text, source);
      text.data = translated;
    }
    return;
  }
  if (!(node instanceof Element)) return;
  for (const attribute of ['aria-label', 'placeholder', 'title'] as const) {
    const value = node.getAttribute(attribute);
    if (!value) continue;
    const attributes = originalAttributes.get(node) ?? new Map<string, string>();
    let source = attributes.get(attribute) ?? value;
    const knownValues = new Set([
      source,
      localizedValue(source, 'en'),
      localizedValue(source, 'zh-CN'),
    ]);
    if (!knownValues.has(value)) {
      source = value;
      attributes.set(attribute, source);
    }
    const translated = localizedValue(source, language);
    if (translated !== value) {
      if (!attributes.has(attribute)) attributes.set(attribute, source);
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
