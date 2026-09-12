import { businessToday } from '@pallet/shared';
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
