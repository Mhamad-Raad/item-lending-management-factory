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
