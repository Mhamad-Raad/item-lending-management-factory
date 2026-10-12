import type { MoneyReceiptDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { MoneyReceipt } from '@/features/receipt/money-receipt';
import { ReceiptPrintPage } from '@/features/receipt/receipt-print-page';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_print/print/ledger/$entryId')({
  beforeLoad: () => requirePermission('orders.view'),
  component: MoneyReceiptPage,
});

/** The receipt of one payment or refund (Q137), in its own tab like the hand-over receipt. */
function MoneyReceiptPage() {
  const { entryId } = Route.useParams();
  usePageTitle('receipt.money.pageTitle');
  const receipt = useQuery({
    queryKey: qk.ledger.receipt(Number(entryId)),
    queryFn: () => apiFetch<MoneyReceiptDto>(`/ledger-entries/${entryId}/receipt`),
    // Its figures are fixed, but a payment deleted since the tab was opened must print as deleted.
    staleTime: 0,
  });

  return (
    <ReceiptPrintPage
      query={receipt}
      refusal={{ code: 'LEDGER_ENTRY_NO_RECEIPT', message: 'errors.LEDGER_ENTRY_NO_RECEIPT' }}
    >
      {(data, onLogoSettled) => <MoneyReceipt receipt={data} onLogoSettled={onLogoSettled} />}
    </ReceiptPrintPage>
  );
}
