import { formatMoney } from '@pallet/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** An amount in IQD: the number reads left to right in every language, the currency follows it (§7.5). */
export function MoneyText({ value, className }: { value: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn('whitespace-nowrap', className)}>
      <span dir="ltr" className="tabular-nums">
        {formatMoney(value)}
      </span>{' '}
      <span>{t('common.currency')}</span>
    </span>
  );
}
