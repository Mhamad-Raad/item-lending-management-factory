import { businessDateToDb, businessToday } from '@pallet/shared';
import type { Clock } from '../clock';
import { ApiError } from '../errors/api-error';

/**
 * A business date may be today or earlier in Asia/Baghdad, never later (§6.1.3). `field` names the
 * body field, so the web app can put the message next to it.
 */
export function assertNotInFuture(clock: Clock, date: string, field: string): void {
  const today = businessToday(clock.now());
  if (date > today) throw new ApiError('BUSINESS_DATE_IN_FUTURE', { field, today });
}

/** A list's range must not run backwards (§6.2): `DATE_RANGE_INVALID`, not an empty page. */
export function assertDateRange(dateFrom: string | undefined, dateTo: string | undefined): void {
  if (dateFrom && dateTo && dateFrom > dateTo) throw new ApiError('DATE_RANGE_INVALID', { dateFrom, dateTo });
}

/** A business-date range as a filter on a DATE column; undefined when it is open at both ends. */
export function businessDateFilter(
  dateFrom: string | undefined,
  dateTo: string | undefined,
): { gte?: Date; lte?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: businessDateToDb(dateFrom) } : {}),
    ...(dateTo ? { lte: businessDateToDb(dateTo) } : {}),
  };
}
