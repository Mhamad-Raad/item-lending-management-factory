import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { creditMessageParams, type CreditExcess } from './order-text';

/** The order would pass the customer's credit limit (§7.4.1). */
export function CreditAlert({ credit }: { credit: CreditExcess }) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertDescription>{t('orders.new.creditExceeded', creditMessageParams(credit))}</AlertDescription>
    </Alert>
  );
}
