import { formatBusinessDate } from '@pallet/shared';
import type { TranslationKey } from '@/i18n/keys';
import { isolate } from '@/lib/bidi';
import { tr } from './receipt-i18n';

/** The red stamp of a paper whose record was reversed or undone, dated; null while it stands (Q137, Q173). */
export function reversedStamp(key: TranslationKey, day: string | null): string | null {
  return day === null ? null : tr(key, { date: isolate(formatBusinessDate(day)) });
}
