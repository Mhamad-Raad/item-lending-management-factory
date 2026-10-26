import { hasMoneyReceipt, type LedgerEntryType } from '@pallet/shared';
import { Printer, ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tip } from '@/components/app/tip';
import { Button } from '@/components/ui/button';
import { printCustomerReturnReceipt, printMoneyReceipt, printReturnPaper } from './print-receipt';

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

/**
 * A refund of a customer return over several orders (Q161): its one paper for the whole visit, printed in place;
 * nothing on any other row (only a refund carries a customer return). On an order's page it sits beside the order's
 * own receipt; the customer's page prints only this one.
 */
export function PrintCustomerReturnReceiptButton({ customerReturnId }: { customerReturnId: number | null }) {
  const { t } = useTranslation();
  if (customerReturnId === null) return null;
  return (
    <Tip label={t('orders.money.printCombined')}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('orders.money.printCombined')}
        onClick={() => printCustomerReturnReceipt(customerReturnId)}
      >
        <ReceiptText aria-hidden />
      </Button>
    </Tip>
  );
}

/**
 * A standing return's printers (Q166), the same wherever it is listed — an order's returns table, the returns list:
 * its own part (`printReturnPaper`) and, for a return of a customer's return over several orders, the visit's one paper
 * beside it (Q161).
 */
export function PrintReturnButtons({
  returnId,
  refundEntryId,
  customerReturnId,
}: {
  returnId: number;
  refundEntryId: number | null;
  customerReturnId: number | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Tip label={t('orders.money.printReceipt')}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('orders.money.printReceipt')}
          onClick={() => printReturnPaper(returnId, refundEntryId)}
        >
          <Printer aria-hidden />
        </Button>
      </Tip>
      <PrintCustomerReturnReceiptButton customerReturnId={customerReturnId} />
    </>
  );
}
