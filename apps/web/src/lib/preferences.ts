import { useSyncExternalStore } from 'react';
import {
  FONT_SIZES,
  FONT_SIZE_PX,
  LANGUAGES,
  RTL_LANGUAGES,
  THEMES,
  type FontSize,
  type Language,
  type Theme,
} from '@pallet/shared';

/** Browser-only preferences (never sent to the server). Keep in sync with public/boot-prefs.js. */
export interface Preferences {
  language: Language;
  theme: Theme;
  fontSize: FontSize;
}

export const PREFERENCES_KEY = 'pallet.prefs.v1';
export const DEFAULT_PREFERENCES: Preferences = { language: 'ckb', theme: 'light', fontSize: 'md' };

/** Language names are always shown in their own script, so they are not translated. */
export const LANGUAGE_NATIVE_NAMES: Readonly<Record<Language, string>> = {
  ckb: 'کوردی',
  ar: 'العربية',
  en: 'English',
};

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

function read(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Partial<Preferences>;
    return {
      language: oneOf(LANGUAGES, saved.language, DEFAULT_PREFERENCES.language),
      theme: oneOf(THEMES, saved.theme, DEFAULT_PREFERENCES.theme),
      fontSize: oneOf(FONT_SIZES, saved.fontSize, DEFAULT_PREFERENCES.fontSize),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export const isRtl = (language: Language): boolean => RTL_LANGUAGES.includes(language);

/** Applies preferences to <html>: lang, dir, dark class, root font size. */
export function applyPreferences(prefs: Preferences): void {
  const root = document.documentElement;
  root.lang = prefs.language;
  root.dir = isRtl(prefs.language) ? 'rtl' : 'ltr';
  root.classList.toggle('dark', prefs.theme === 'dark');
  root.style.colorScheme = prefs.theme;
  root.style.setProperty('--app-font-size', `${FONT_SIZE_PX[prefs.fontSize]}px`);
}

let current: Preferences = typeof window === 'undefined' ? DEFAULT_PREFERENCES : read();
const listeners = new Set<() => void>();

export function getPreferences(): Preferences {
  return current;
}

export function setPreferences(patch: Partial<Preferences>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: the preference still applies for this page view.
  }
  applyPreferences(current);
  listeners.forEach((notify) => notify());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, () => DEFAULT_PREFERENCES);
}
