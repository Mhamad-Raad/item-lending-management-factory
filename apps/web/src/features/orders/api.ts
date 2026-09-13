import type { OrderDetailDto } from '@pallet/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export function orderQuery(orderId: number) {
  return queryOptions({
    queryKey: qk.orders.detail(orderId),
    queryFn: () => apiFetch<OrderDetailDto>(`/orders/${orderId}`),
  });
}

/**
 * What creating, editing or cancelling an order can make stale (§7.8.4): every order view, the
 * customer's totals and holdings, stock, the money ledger, and the pages that sum them.
 */
export async function invalidateAfterOrderChange(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    [qk.orders.all(), qk.customers.all(), qk.items.all(), qk.ledger.all(), qk.dashboard(), qk.reports.all()].map(
      (queryKey) => queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

/**
 * What a payment or its reversal can make stale (§7.8.4): its order and the order lists, the customer's
 * totals and timeline, the money ledger, and the pages that sum them. Stock does not move.
 */
export async function invalidateAfterPayment(
  queryClient: QueryClient,
  order: Pick<OrderDetailDto, 'id' | 'customer'>,
): Promise<void> {
  await Promise.all(
    [
      qk.orders.detail(order.id),
      ['orders', 'list'],
      qk.customers.detail(order.customer.id),
      ['customers', 'history', order.customer.id],
      ['customers', 'list'],
      qk.ledger.all(),
      qk.dashboard(),
      qk.reports.all(),
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
