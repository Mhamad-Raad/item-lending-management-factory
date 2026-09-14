import type { PaymentType } from '@pallet/shared';
import { Banknote, Handshake } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/** An order's payment type, translated. */
export function PaymentTypeText({ type }: { type: PaymentType }) {
  const { t } = useTranslation();
  return <>{t(`enums.paymentType.${type}`)}</>;
}

const BADGE = {
  CASH: { icon: Banknote, variant: 'success' },
  LENT: { icon: Handshake, variant: 'warning' },
} as const;

/** The payment type as a coloured pill with its icon, for lists where it is scanned down a column. */
export function PaymentTypeBadge({ type }: { type: PaymentType }) {
  const { icon: Icon, variant } = BADGE[type];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      <PaymentTypeText type={type} />
    </Badge>
  );
}
