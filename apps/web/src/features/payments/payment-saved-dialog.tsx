import { formatOrderNumber, type PaymentCreateBody, type PaymentResultDto } from '@pallet/shared';
import { Printer } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DateText } from '@/components/app/date-text';
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
import { printMoneyReceipt } from '@/features/receipt/print-receipt';

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between gap-2 text-base font-semibold' : 'flex justify-between gap-2'}>
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="min-w-0 text-end break-words">{children}</dd>
    </div>
  );
}

/**
 * What a payment just recorded was (Q139): the amount, date and note as sent and stored, and the order's balance
 * either side of it, with its receipt one press away. The balance is the answer's: the order as the payment left
 * it, read under the lock it was checked under, so what it owed before is what it owes now plus the payment — the
 * receipt's `owedBefore`.
 */
export function PaymentSavedDialog({
  result,
  payment,
  open,
  onClose,
}: {
  result: PaymentResultDto;
  payment: PaymentCreateBody;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const print = useRef<HTMLButtonElement>(null);
  const { order } = result;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        closeLabel={t('common.actions.close')}
        className="sm:max-w-md"
        // The receipt is what is wanted next, while the customer is still there.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          print.current?.focus();
        }}
        // Closed on purpose only (Close, Escape, the corner button): closing goes on to the order, and a press
        // beside it while the money is being handed over must not take the receipt away.
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('payments.new.created', { orderNumber: formatOrderNumber(order.orderNumber) })}</DialogTitle>
          <DialogDescription>
            <bdi>{order.customer.name}</bdi>
          </DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-3 text-sm">
          <Row label={t('payments.fields.date')}>
            <DateText value={payment.date} />
          </Row>
          <Row label={t('payments.new.owedBefore')}>
            <MoneyText value={order.owed + payment.amount} />
          </Row>
          <Row label={t('payments.new.payment')} strong>
            <MoneyText value={payment.amount} />
          </Row>
          <Row label={t('payments.new.owedAfter')}>
            <MoneyText value={order.owed} />
          </Row>
          {payment.note ? (
            <Row label={t('payments.fields.note')}>
              <bdi>{payment.note}</bdi>
            </Row>
          ) : null}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.actions.close')}
          </Button>
          <Button ref={print} onClick={() => printMoneyReceipt(result.ledgerEntryId)}>
            <Printer aria-hidden />
            {t('orders.money.printReceipt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
