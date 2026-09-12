import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { creditMessageParams, type CreditExcess } from './order-text';

/**
 * The order would pass the customer's credit limit (§7.4.1). A new order is judged on its total; an
 * edit on the increase (§4.4), and the sentence says which.
 */
export function CreditAlert({ credit, kind }: { credit: CreditExcess; kind: 'order' | 'change' }) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertDescription>
        {t(kind === 'order' ? 'orders.new.creditExceeded' : 'orders.edit.creditExceeded', creditMessageParams(credit))}
      </AlertDescription>
    </Alert>
  );
}
