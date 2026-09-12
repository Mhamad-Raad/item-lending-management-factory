import { formatNumber } from '@pallet/shared';
import { cn } from '@/lib/utils';

/** A count of pallets, with Western digits and thousands separators (§7.5). */
export function QuantityText({ value, className }: { value: number; className?: string }) {
  return (
    <span dir="ltr" className={cn('tabular-nums', className)}>
      {formatNumber(value)}
    </span>
  );
}
