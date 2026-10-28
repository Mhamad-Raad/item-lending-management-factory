import type { ReturnWithOrderDto } from '@pallet/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { orderLabel } from '@/features/orders/order-text';
import { isolate } from '@/lib/bidi';

/**
 * The other order a return was recorded with (Q175), linked to it: its pallets count here, but they came back with
 * that order, whose receipt lists them too — so the same pallets never read as returned twice.
 */
export function WithOrderTag({ withOrder }: { withOrder: ReturnWithOrderDto | null }) {
  const { t } = useTranslation();
  if (!withOrder) return null;
  return (
    // The info badge's look, as a link.
    <Link
      to="/orders/$orderId"
      params={{ orderId: String(withOrder.id) }}
      className="bg-info/12 text-info border-info/30 dark:bg-info/20 inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap underline-offset-4 hover:underline"
    >
      {t('returns.withOrder.tag', { orderNumber: isolate(orderLabel(withOrder.orderNumber)) })}
    </Link>
  );
}
