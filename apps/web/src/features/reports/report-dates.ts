import { businessToday } from '@pallet/shared';
import { ApiError } from '@/lib/api-error';

export type PeriodRefusal = 'DATE_RANGE_INVALID' | 'BUSINESS_DATE_IN_FUTURE';

/**
 * A period report's dates (§12.1): the current month in Baghdad, from its first day to today, unless the
 * URL names them, and why the API would refuse them, so the page says so on the field instead of asking.
 */
export function reportPeriod(search: { dateFrom?: string; dateTo?: string }): {
  dateFrom: string;
  dateTo: string;
  refusal: PeriodRefusal | null;
} {
  const today = businessToday();
  const dateFrom = search.dateFrom ?? `${today.slice(0, 8)}01`;
  const dateTo = search.dateTo ?? today;
  const refusal = dateFrom > dateTo ? 'DATE_RANGE_INVALID' : dateTo > today ? 'BUSINESS_DATE_IN_FUTURE' : null;
  return { dateFrom, dateTo, refusal };
}

/** The same refusals from the server — its clock can be behind the browser's around midnight. */
export function periodRefusalOf(error: unknown): PeriodRefusal | null {
  if (!(error instanceof ApiError)) return null;
  return error.code === 'DATE_RANGE_INVALID' || error.code === 'BUSINESS_DATE_IN_FUTURE' ? error.code : null;
}
