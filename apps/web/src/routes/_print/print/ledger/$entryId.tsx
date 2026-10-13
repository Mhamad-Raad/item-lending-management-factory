import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { MoneyReceipt } from '@/features/receipt/money-receipt';
import { moneyReceiptQuery } from '@/features/receipt/api';
import { ReceiptPrintPage } from '@/features/receipt/receipt-print-page';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_print/print/ledger/$entryId')({
  beforeLoad: () => requirePermission('orders.view'),
  component: MoneyReceiptPage,
});

/** The receipt of one payment or refund (Q137), at its own address; the app's buttons print it in place (Q140). */
function MoneyReceiptPage() {
  const { entryId } = Route.useParams();
  usePageTitle('receipt.money.pageTitle');
  const receipt = useQuery(moneyReceiptQuery(Number(entryId)));

  return (
    <ReceiptPrintPage
      query={receipt}
      refusal={{ code: 'LEDGER_ENTRY_NO_RECEIPT', message: 'errors.LEDGER_ENTRY_NO_RECEIPT' }}
    >
      {(data, onLogoSettled) => <MoneyReceipt receipt={data} onLogoSettled={onLogoSettled} />}
    </ReceiptPrintPage>
  );
}
