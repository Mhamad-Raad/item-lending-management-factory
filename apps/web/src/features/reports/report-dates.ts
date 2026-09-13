import { businessToday } from '@pallet/shared';

/** §12.1: a period report opens on the current month in Baghdad, from its first day to today. */
export function defaultPeriod(): { dateFrom: string; dateTo: string } {
  const today = businessToday();
  return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
}
