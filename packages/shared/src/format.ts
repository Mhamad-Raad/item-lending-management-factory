/** Western digits and comma thousands in every language: i18next never formats numbers (§7.10). */
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** Whole IQD, shown as a plain number; `MoneyText` adds the currency label (§7.5). */
export function formatMoney(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** Order numbers are shown six digits wide: 42 → `000042` (§8.7). */
export function formatOrderNumber(value: number): string {
  return String(value).padStart(6, '0');
}

/** Arabic-Indic (٠–٩) and Extended Arabic-Indic (۰–۹) digits: what Sorani and Arabic keyboards type. */
const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

/** Maps Eastern digits to 0–9 and leaves everything else as it is (§8.7). */
export function toWesternDigits(value: string): string {
  return value.replace(EASTERN_DIGITS, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * A phone number as it is stored and compared (Q13): Western digits, without the spaces, dashes and
 * parentheses people type for readability. Whether the result is a phone number is `Phone`'s call.
 */
export function normalizePhone(value: string): string {
  return toWesternDigits(value).replace(/[\s\-()]/g, '');
}

/**
 * JSON with object keys sorted at every depth and no whitespace (§8.7), so two bodies that differ only
 * in key order hash the same: a retried submission is recognised as the same submission.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortKeys(record[key])]),
  );
}
