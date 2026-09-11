import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getPreferences } from '@/lib/preferences';
import ar from './locales/ar.json';
import ckb from './locales/ckb.json';
import en from './locales/en.json';

export const resources = {
  ckb: { translation: ckb },
  ar: { translation: ar },
  en: { translation: en },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: getPreferences().language,
  // No fallback language: every key must exist in all three files (enforced by locales.test.ts).
  fallbackLng: false,
  interpolation: { escapeValue: false }, // React already escapes.
  returnNull: false,
});

export default i18n;
