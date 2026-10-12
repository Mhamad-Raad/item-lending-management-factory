import type { ReceiptDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Receipt } from '@/features/receipt/receipt';
import { ReceiptPrintPage } from '@/features/receipt/receipt-print-page';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_print/print/orders/$orderId')({
  beforeLoad: () => requirePermission('orders.view'),
  component: ReceiptPage,
});

/** The hand-over receipt's tab (§7.16.1). */
function ReceiptPage() {
  const { orderId } = Route.useParams();
  usePageTitle('receipt.pageTitle');
  const receipt = useQuery({
    queryKey: qk.orders.receipt(Number(orderId)),
    queryFn: () => apiFetch<ReceiptDto>(`/orders/${orderId}/receipt`),
    // The receipt says what has come back so far (Q134): a tab left open reads the order again when it is returned to.
    staleTime: 0,
  });

  return (
    <ReceiptPrintPage query={receipt} refusal={{ code: 'ORDER_CANCELLED', message: 'receipt.cancelledError' }}>
      {(data, onLogoSettled) => <Receipt receipt={data} onLogoSettled={onLogoSettled} />}
    </ReceiptPrintPage>
  );
}
