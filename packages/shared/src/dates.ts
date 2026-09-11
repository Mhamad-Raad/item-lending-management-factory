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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The UTC instant at which a Baghdad calendar day begins. The offset comes from the timezone
 * database rather than a constant: Baghdad is UTC+3 today, but observed DST until 2008 and
 * `MIN_BUSINESS_DATE` reaches back to 2000.
 */
export function businessDayStartUtc(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(new TZDate(year, month - 1, day, 0, 0, 0, 0, BUSINESS_TIME_ZONE).getTime());
}

/**
 * Turns a `dateFrom`/`dateTo` filter over Baghdad calendar days into the half-open UTC interval
 * `[from 00:00, to+1 00:00)` that a timestamp column is filtered with (§11.6). Returns undefined
 * when neither bound is given, so the caller can leave the filter out entirely.
 */
export function businessDayRangeToUtc(dateFrom?: string, dateTo?: string): { gte?: Date; lt?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined;

  return {
    ...(dateFrom ? { gte: businessDayStartUtc(dateFrom) } : {}),
    // Inclusive of the whole `dateTo` day: the interval ends when the next day begins.
    ...(dateTo ? { lt: new Date(businessDayStartUtc(dateTo).getTime() + MS_PER_DAY) } : {}),
  };
}
