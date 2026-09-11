import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

/** The business timezone. Iraq is UTC+3 all year (no DST). */
export const BUSINESS_TIME_ZONE = 'Asia/Baghdad';

/** Earliest business date accepted by the API. */
export const MIN_BUSINESS_DATE = '2000-01-01';

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar day in Asia/Baghdad as `YYYY-MM-DD`. */
export function businessToday(now: Date = new Date()): string {
  return format(new TZDate(now.getTime(), BUSINESS_TIME_ZONE), 'yyyy-MM-dd');
}

/** True when `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isBusinessDate(value: string): boolean {
  if (!BUSINESS_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` → Date at UTC midnight (how Prisma represents a PostgreSQL `date`). */
export function businessDateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date from a PostgreSQL `date` column → `YYYY-MM-DD`. */
export function dbDateToBusiness(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Display format for business dates in every UI language and on the receipt: `dd/MM/yyyy`. */
export function formatBusinessDate(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

/** Display a UTC timestamp in Asia/Baghdad as `dd/MM/yyyy HH:mm`. */
export function formatTimestamp(value: string | Date): string {
  const ms = typeof value === 'string' ? Date.parse(value) : value.getTime();
  return format(new TZDate(ms, BUSINESS_TIME_ZONE), 'dd/MM/yyyy HH:mm');
}
