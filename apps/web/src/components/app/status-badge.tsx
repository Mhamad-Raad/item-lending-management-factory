import type { OrderStatus } from '@pallet/shared';
import { Ban, CircleCheck, CircleDot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

const STYLE = {
  OPEN: { icon: CircleDot, variant: 'outline' },
  SETTLED: { icon: CircleCheck, variant: 'success' },
  CANCELLED: { icon: Ban, variant: 'secondary' },
} as const;

/** An order's status, always as icon and text (§7.5, §7.15). */
export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const { icon: Icon, variant } = STYLE[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {t(`enums.orderStatus.${status}`)}
    </Badge>
  );
}
