import { formatNumber, type CustomerReturnRecordedDto, type CustomerReturnResultDto } from '@pallet/shared';
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
import { isolate } from '@/lib/bidi';
import { printCustomerReturnReceipt, printReturnPaper } from '@/features/receipt/print-receipt';
import { CashHandover } from './cash-handover';

/** The paper a print button gives, and its label. */
type Paper = { label: string; print: () => void };

/**
 * What a customer return recorded (Q156): a row per order's return, and its receipt one press away for the customer to
 * sign for — one paper for a return over several orders, cash paid back or not (Q161, Q166), and on one order the
 * refund's own when cash went out (Q137), else the return's own paper in the same design (Q166). Shown after every
 * return, on one order as on several (Q166); closing goes on.
 */
export function ReturnsSavedDialog({
  result,
  paidBefore,
  open,
  onClose,
}: {
  result: CustomerReturnResultDto;
  /** On an edit (Q174), the cash its old return had paid back: only the difference changes hands. */
  paidBefore?: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const print = useRef<HTMLButtonElement>(null);
  const cash = result.returns.reduce((total, entry) => total + entry.cashRefund, 0);
  // Read with `??`: a result stored before Q161 and replayed for its key has no such field.
  const visit = result.customerReturnId ?? null;
  const paperOf = (entry: CustomerReturnRecordedDto): Paper => {
    const refundEntryId = entry.refundEntryId;
    return { label: t('orders.money.printReceipt'), print: () => printReturnPaper(entry.returnId, refundEntryId) };
  };
  const [only] = result.returns;
  // One button at the foot, as over several orders: the visit's paper, or the one order's.
  const footPaper: Paper | null =
    visit !== null
      ? { label: t('orders.money.printReceipt'), print: () => printCustomerReturnReceipt(visit) }
      : result.returns.length === 1 && only
        ? paperOf(only)
        : null;

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
          <DialogTitle>
            {t(paidBefore === undefined ? 'returns.customer.savedTitle' : 'returns.edit.savedTitle')}
          </DialogTitle>
          <DialogDescription>
            <bdi>{result.customer.name}</bdi>
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y text-sm">
          {result.returns.map((entry) => {
            // Several orders replayed from before Q161, without a visit: each prints its own.
            const rowPaper = footPaper === null ? paperOf(entry) : null;
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
                <div className="flex items-center gap-3">
                  {entry.refundEntryId === null ? (
                    <span className="text-muted-foreground">
                      {t('returns.new.owedAfter')}: <MoneyText value={entry.owedAfter} />
                    </span>
                  ) : (
                    <MoneyText value={entry.cashRefund} className="font-semibold" />
                  )}
                  {rowPaper ? (
                    <Button
                      ref={entry.returnId === result.returns[0]?.returnId ? print : undefined}
                      size="sm"
                      onClick={rowPaper.print}
                    >
                      <Printer aria-hidden />
                      {rowPaper.label}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {/* Read with `??`: a result stored before Q170 and replayed for its key has none. */}
        {(result.surplus ?? []).length > 0 ? (
          <p
            role="status"
            className="bg-warning/12 text-warning rounded-md p-3 text-sm font-semibold dark:bg-warning/20"
          >
            {t('returns.customer.savedExtra', {
              items: (result.surplus ?? [])
                .map((entry) => `${formatNumber(entry.quantity)} × ${isolate(entry.item.name)}`)
                .join(t('common.listSeparator')),
            })}
          </p>
        ) : null}
        <CashHandover cash={cash} paidBefore={paidBefore} className="text-sm" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.actions.close')}
          </Button>
          {footPaper ? (
            <Button ref={print} onClick={footPaper.print}>
              <Printer aria-hidden />
              {footPaper.label}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
