import { isBusinessDate, toWesternDigits } from '@pallet/shared';

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
