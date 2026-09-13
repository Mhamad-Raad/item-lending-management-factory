import { LANGUAGES } from '@pallet/shared';
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
  supportedLngs: [...LANGUAGES],
  // No fallback language: every key must exist in all three files (enforced by locales.test.ts).
  fallbackLng: false,
  interpolation: { escapeValue: false }, // React already escapes.
  returnNull: false,
  returnEmptyString: false,
  react: { useSuspense: false },
  // A key missing at runtime (one built from data) is reported while developing, never in production.
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (languages, _namespace, key) => {
    console.error('[i18n] missing', languages[0], key);
  },
});

export default i18n;
