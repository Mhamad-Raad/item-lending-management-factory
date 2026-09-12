import { formatNumber, toWesternDigits } from '@pallet/shared';

/** More digits than this cannot be a valid amount (1e12 is the ceiling) and would lose precision. */
const MAX_DIGITS = 15;

/**
 * What a numeric box holds after a keystroke (§7.5): Eastern digits read as Western, everything but
 * digits dropped — a leading minus kept when negatives are allowed — and the number shown again with
 * thousands separators. `value` is null for an empty box.
 */
export function parseNumericInput(raw: string, allowNegative: boolean): { value: number | null; text: string } {
  const western = toWesternDigits(raw).trim();
  const negative = allowNegative && western.startsWith('-');
  const digits = western
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, MAX_DIGITS);

  if (digits === '') return { value: null, text: negative ? '-' : '' };
  const magnitude = Number(digits);
  // "-0" is a minus the user is still typing a number after; the value is plain 0.
  if (magnitude === 0) return { value: 0, text: negative ? '-0' : '0' };
  const value = negative ? -magnitude : magnitude;
  return { value, text: formatNumber(value) };
}

/** How many digits precede a caret position, so the caret can be put back after reformatting. */
export function digitsBefore(text: string, caret: number): number {
  return (toWesternDigits(text.slice(0, caret)).match(/\d/g) ?? []).length;
}

/** The caret position in `text` just after its `count`-th digit (or after the sign when zero). */
export function caretAfterDigits(text: string, count: number): number {
  if (count <= 0) return text.startsWith('-') ? 1 : 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/\d/.test(text.charAt(index))) seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
}
