import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Receipt } from '@/features/receipt/receipt';
import { orderReceiptQuery } from '@/features/receipt/api';
import { ReceiptPrintPage } from '@/features/receipt/receipt-print-page';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_print/print/orders/$orderId')({
  beforeLoad: () => requirePermission('orders.view'),
  component: ReceiptPage,
});

/** The hand-over receipt at its own address (§7.16.1); the app's buttons print it in place (Q140). */
function ReceiptPage() {
  const { orderId } = Route.useParams();
  usePageTitle('receipt.pageTitle');
  const receipt = useQuery(orderReceiptQuery(Number(orderId)));

  return (
    <ReceiptPrintPage query={receipt} refusal={{ code: 'ORDER_CANCELLED', message: 'receipt.cancelledError' }}>
      {(data, onLogoSettled) => <Receipt receipt={data} onLogoSettled={onLogoSettled} />}
    </ReceiptPrintPage>
  );
}
