import { formatMoney, formatNumber, type CustomerReturnResultDto } from '@pallet/shared';
import { Printer } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyText } from '@/components/app/money-text';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { orderLabel } from '@/features/orders/order-text';
import { printCustomerReturnReceipt, printMoneyReceipt } from '@/features/receipt/print-receipt';

/**
 * What a customer return paid out (Q156): a row per order's return, and its receipt one press away for the customer to
 * sign for — one paper for a return over several orders (Q161), the order's own for a return on one (Q137); a result
 * without a visit (one order, or replayed from before Q161) prints each refund's own. Shown only when cash went out;
 * closing goes on.
 */
export function ReturnsSavedDialog({
  result,
  open,
  onClose,
}: {
  result: CustomerReturnResultDto;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const print = useRef<HTMLButtonElement>(null);
  const cash = result.returns.reduce((total, entry) => total + entry.cashRefund, 0);
  // Read with `??`: a result stored before Q161 and replayed for its key has no such field.
  const visit = result.customerReturnId ?? null;
  const firstRefund = result.returns.find((entry) => entry.refundEntryId !== null)?.returnId;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        closeLabel={t('common.actions.close')}
        className="sm:max-w-lg"
        // The receipt is what is wanted next, while the customer is still there.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          print.current?.focus();
        }}
        // Closed on purpose only: a press beside it while the money is handed over must not take the receipts away.
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('returns.customer.savedTitle')}</DialogTitle>
          <DialogDescription>
            <bdi>{result.customer.name}</bdi>
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y text-sm">
          {result.returns.map((entry) => {
            const refundEntryId = entry.refundEntryId;
            return (
              <li key={entry.returnId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex min-w-0 flex-col">
                  <span dir="ltr" className="self-start font-semibold">
                    {orderLabel(entry.orderNumber)}
                  </span>
                  <span className="text-muted-foreground">
                    {t('returns.customer.savedLine', {
                      accepted: formatNumber(entry.accepted),
                      damaged: formatNumber(entry.damaged),
                    })}
                  </span>
                </div>
                {refundEntryId === null ? (
                  <span className="text-muted-foreground">
                    {t('returns.new.owedAfter')}: <MoneyText value={entry.owedAfter} />
                  </span>
                ) : (
                  <div className="flex items-center gap-3">
                    <MoneyText value={entry.cashRefund} className="font-semibold" />
                    {visit === null ? (
                      <Button
                        ref={entry.returnId === firstRefund ? print : undefined}
                        size="sm"
                        onClick={() => printMoneyReceipt(refundEntryId)}
                      >
                        <Printer aria-hidden />
                        {t('orders.money.printReceipt')}
                      </Button>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="bg-success/12 text-success rounded-md p-3 text-sm font-semibold dark:bg-success/20">
          {t('returns.new.cashHandover', { amount: formatMoney(cash) })}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.actions.close')}
          </Button>
          {visit !== null ? (
            <Button ref={print} onClick={() => printCustomerReturnReceipt(visit)}>
              <Printer aria-hidden />
              {t('orders.money.printReceipt')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
