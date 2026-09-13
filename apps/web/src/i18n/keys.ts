import type { ParseKeys } from 'i18next';

/** A key of the translation files, checked against `en.json` (§7.10). */
export type TranslationKey = ParseKeys;

/**
 * A key assembled from data the type system cannot follow — an audit summary from the API, a permission
 * name. `locales.test.ts` is what proves each of these exists in every language.
 */
export function dynamicKey(key: string): TranslationKey {
  return key as TranslationKey;
}
