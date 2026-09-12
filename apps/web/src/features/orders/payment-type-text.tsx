import type { PaymentType } from '@pallet/shared';
import { useTranslation } from 'react-i18next';

/** An order's payment type, translated. */
export function PaymentTypeText({ type }: { type: PaymentType }) {
  const { t } = useTranslation();
  return <>{t(`enums.paymentType.${type}`)}</>;
}
