'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LANG_COOKIE, LOCALES, localeFromValue, localeMeta } from '@/lib/i18n';
import { MESSAGES } from '@/lib/messages';

const I18nContext = createContext(null);

function persistLocale(id) {
  try {
    localStorage.setItem(LANG_COOKIE, id);
  } catch {
    /* ignore */
  }
  document.cookie = `${LANG_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
  const meta = localeMeta(id);
  document.documentElement.lang = id;
  document.documentElement.dir = meta.dir;
}

export function I18nProvider({ children, initialLocale = 'en' }) {
  const [locale, setLocaleState] = useState(initialLocale);

  useEffect(() => {
    const stored = localeFromValue(localStorage.getItem(LANG_COOKIE));
    if (stored) {
      setLocaleState(stored);
      persistLocale(stored);
      return;
    }
    const nav = navigator.languages?.length ? navigator.languages : [navigator.language];
    let detected = null;
    for (const lang of nav) {
      detected = localeFromValue(lang);
      if (detected) break;
    }
    const next = detected || initialLocale;
    setLocaleState(next);
    persistLocale(next);
  }, [initialLocale]);

  const value = useMemo(() => {
    const dict = MESSAGES[locale] || MESSAGES.en;
    return {
      locale,
      locales: LOCALES,
      dir: localeMeta(locale).dir,
      t(key) {
        return dict[key] || MESSAGES.en[key] || key;
      },
      setLocale(id) {
        const next = localeFromValue(id) || 'en';
        setLocaleState(next);
        persistLocale(next);
      }
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: 'en',
      locales: LOCALES,
      dir: 'ltr',
      t: (key) => MESSAGES.en[key] || key,
      setLocale() {}
    };
  }
  return ctx;
}
