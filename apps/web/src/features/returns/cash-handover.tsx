import { formatMoney } from '@pallet/shared';
import { HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isolate } from '@/lib/bidi';
import { cn } from '@/lib/utils';

/**
 * The cash a return hands over (Q137): its whole refund — or, on an edit of a return that had paid cash back (Q174),
 * only the difference, more to hand over or some to take back, and nothing when it is the same.
 */
export function CashHandover({
  cash,
  paidBefore = 0,
  icon = false,
  className,
}: {
  cash: number;
  paidBefore?: number;
  icon?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const difference = paidBefore > 0 ? cash - paidBefore : cash;
  if (difference === 0) return null;
  const text =
    paidBefore === 0
      ? t('returns.new.cashHandover', { amount: formatMoney(cash) })
      : t(difference > 0 ? 'returns.edit.cashMore' : 'returns.edit.cashBack', {
          paid: isolate(formatMoney(paidBefore)),
          amount: isolate(formatMoney(Math.abs(difference))),
        });
  return (
    <p
      className={cn(
        'flex items-center gap-2 rounded-md p-3 font-semibold',
        difference > 0
          ? 'bg-success/12 text-success dark:bg-success/20'
          : 'bg-warning/12 text-warning dark:bg-warning/20',
        className,
      )}
    >
      {icon ? <HandCoins className="size-5 shrink-0" aria-hidden /> : null}
      {text}
    </p>
  );
}
