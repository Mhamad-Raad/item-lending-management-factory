import { isBusinessDate, toWesternDigits } from '@pallet/shared';

/** The longest a typed date can be: `dd/MM/yyyy`. */
export const TYPED_DATE_MAX_LENGTH = 10;

/**
 * What a date box keeps of what was typed (Q148): digits — Eastern ones as Western — and `/`, with `-` or `.`
 * read as `/`; letters and anything else are dropped. The box refuses a keystroke that would pass
 * `TYPED_DATE_MAX_LENGTH` rather than cutting the end off.
 */
export function sanitizeTypedDate(text: string): string {
  return toWesternDigits(text)
    .replace(/[.-]/g, '/')
    .replace(/[^0-9/]/g, '');
}

/**
 * A date typed as `dd/MM/yyyy` — Eastern digits, and `-` or `.` between the parts, accepted — as a
 * business date `YYYY-MM-DD`, or null when it is not a real calendar day (§7.5).
 */
export function parseTypedDate(text: string): string | null {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(toWesternDigits(text).trim());
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isBusinessDate(value) ? value : null;
}

/** The calendar's local-midnight `Date` for a business date; a calendar only deals in days. */
export function businessDateToLocal(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1);
}

export function localToBusinessDate(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
