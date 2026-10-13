import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { transactionsReceiptQuery } from '@/features/receipt/api';
import { ReceiptPrintPage } from '@/features/receipt/receipt-print-page';
import { TransactionsReceipt } from '@/features/receipt/transactions-receipt';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_print/print/transactions/$orderId')({
  beforeLoad: () => requirePermission('orders.view'),
  component: TransactionsReceiptPage,
});

/** Every payment and refund of an order on one paper (Q139), at its own address; the app's buttons print it in place (Q140). */
function TransactionsReceiptPage() {
  const { orderId } = Route.useParams();
  usePageTitle('receipt.transactions.pageTitle');
  const receipt = useQuery(transactionsReceiptQuery(Number(orderId)));

  return (
    <ReceiptPrintPage query={receipt}>
      {(data, onLogoSettled) => <TransactionsReceipt receipt={data} onLogoSettled={onLogoSettled} />}
    </ReceiptPrintPage>
  );
}
