import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { customerReturnReceiptQuery } from '@/features/receipt/api';
import { CustomerReturnReceipt } from '@/features/receipt/money-receipt';
import { ReceiptPrintPage } from '@/features/receipt/receipt-print-page';
import { usePageTitle } from '@/hooks/use-page-title';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_print/print/customer-returns/$customerReturnId')({
  beforeLoad: () => requirePermission('orders.view'),
  component: CustomerReturnReceiptPage,
});

/** A customer return's one receipt over its orders (Q161), at its own address; the app's buttons print it in place. */
function CustomerReturnReceiptPage() {
  const { customerReturnId } = Route.useParams();
  usePageTitle('receipt.money.pageTitle');
  const receipt = useQuery(customerReturnReceiptQuery(Number(customerReturnId)));

  return (
    <ReceiptPrintPage
      query={receipt}
      refusal={{ code: 'CUSTOMER_RETURN_NO_RECEIPT', message: 'errors.CUSTOMER_RETURN_NO_RECEIPT' }}
    >
      {(data, onLogoSettled) => <CustomerReturnReceipt receipt={data} onLogoSettled={onLogoSettled} />}
    </ReceiptPrintPage>
  );
}
