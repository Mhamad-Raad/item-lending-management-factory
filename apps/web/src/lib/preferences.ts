import { useSyncExternalStore } from 'react';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_SIZE_PX,
  LANGUAGES,
  PALETTES,
  RTL_LANGUAGES,
  THEMES,
  type FontFamily,
  type FontSize,
  type Language,
  type Palette,
  type ResolvedTheme,
  type Theme,
} from '@pallet/shared';

/**
 * Browser-only preferences (never sent to the server). Keep in sync with public/boot-prefs.js, except
 * `sidebarCollapsed`: the sidebar is drawn by React from this store on its first render, so nothing needs it before paint.
 */
export interface Preferences {
  language: Language;
  theme: Theme;
  palette: Palette;
  font: FontFamily;
  fontSize: FontSize;
  /** The desktop sidebar reduced to its icons (Q51). */
  sidebarCollapsed: boolean;
}

export const PREFERENCES_KEY = 'pallet.prefs.v1';
export const DEFAULT_PREFERENCES: Preferences = {
  language: 'ckb',
  theme: 'light',
  palette: 'harbor',
  font: 'inter',
  fontSize: 'md',
  sidebarCollapsed: false,
};

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
      palette: oneOf(PALETTES, saved.palette, DEFAULT_PREFERENCES.palette),
      font: oneOf(FONT_FAMILIES, saved.font, DEFAULT_PREFERENCES.font),
      fontSize: oneOf(FONT_SIZES, saved.fontSize, DEFAULT_PREFERENCES.fontSize),
      sidebarCollapsed: saved.sidebarCollapsed === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export const isRtl = (language: Language): boolean => RTL_LANGUAGES.includes(language);

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The theme the screen shows: `system` follows the device. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Applies preferences to <html>: lang, dir, dark class, colour theme, typeface, root font size. A print page marks
 * the root `data-force-light`, and stays light whatever the theme or the device does meanwhile (§7.12).
 */
export function applyPreferences(prefs: Preferences): void {
  const root = document.documentElement;
  root.lang = prefs.language;
  root.dir = isRtl(prefs.language) ? 'rtl' : 'ltr';
  const resolved = root.dataset.forceLight ? 'light' : resolveTheme(prefs.theme);
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  root.dataset.palette = prefs.palette;
  root.dataset.font = prefs.font;
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

// "System" follows the device while the app is open, not only when it loads.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (current.theme !== 'system') return;
    // A new snapshot, so every useSyncExternalStore reader re-renders with the theme now on screen.
    current = { ...current };
    applyPreferences(current);
    listeners.forEach((notify) => notify());
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, () => DEFAULT_PREFERENCES);
}

/** The theme on screen now, for the few places that need a concrete one (the toaster). */
export function useResolvedTheme(): ResolvedTheme {
  const { theme } = usePreferences();
  return resolveTheme(theme);
}
