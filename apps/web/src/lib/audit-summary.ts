import type { TFunction } from 'i18next';

/**
 * Audit summaries interpolate raw enum values (`role`, and the `reason` of a failed sign-in). The
 * API stores them untranslated by design — prose never crosses the wire — so the sentence is only
 * readable once they are translated here.
 */
const ENUM_PARAMS: Record<string, (value: string) => string> = {
  role: (value) => `enums.role.${value}`,
  reason: (value) => `auth.loginFailure.${value}`,
};

export function translateSummaryParams(t: TFunction, params: Record<string, unknown>): Record<string, unknown> {
  const translated: Record<string, unknown> = { ...params };
  for (const [key, toKey] of Object.entries(ENUM_PARAMS)) {
    const value = params[key];
    if (typeof value === 'string') translated[key] = t(toKey(value));
  }
  return translated;
}
