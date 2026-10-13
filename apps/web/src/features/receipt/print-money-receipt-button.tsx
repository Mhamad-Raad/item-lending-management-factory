import { hasMoneyReceipt, type LedgerEntryType } from '@pallet/shared';
import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tip } from '@/components/app/tip';
import { Button } from '@/components/ui/button';
import { printMoneyReceipt } from './print-receipt';

/** The printer icon of a money row (Q137): prints a payment's or a refund's receipt in place (Q140); nothing on a reversal. */
export function PrintMoneyReceiptButton({ entry }: { entry: { id: number; type: LedgerEntryType } }) {
  const { t } = useTranslation();
  if (!hasMoneyReceipt(entry.type)) return null;
  return (
    <Tip label={t('orders.money.printReceipt')}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('orders.money.printReceipt')}
        onClick={() => printMoneyReceipt(entry.id)}
      >
        <Printer aria-hidden />
      </Button>
    </Tip>
  );
}
